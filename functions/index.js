const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

setGlobalOptions({
  region: "asia-southeast2",
  maxInstances: 1,
  memory: "256MiB"
});

const db = getFirestore();
const TIME_ZONE = "Asia/Jakarta";
const BATCH_LIMIT = 450;

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function dateKeyFromNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyToUtcMs(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

function diffDays(fromKey, toKey) {
  return Math.round((dateKeyToUtcMs(toKey) - dateKeyToUtcMs(fromKey)) / 86400000);
}

function formatDueDate(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

function notificationPlanForTask(task, todayKey) {
  const dueKey = String(task.due || "").slice(0, 10);

  if (!isDateKey(dueKey)) {
    return null;
  }

  const difference = diffDays(todayKey, dueKey);

  if (task.status === "done" || task.archived === true) {
    return null;
  }

  if (difference === 3) {
    return {
      kind: "d3",
      type: "deadline",
      title: "Task due in 3 days",
      body: `${String(task.title || "Task")} — due ${formatDueDate(dueKey)}`,
      id: `deadline-${String(task.id)}-d3-${dueKey}`
    };
  }

  if (difference === 1) {
    return {
      kind: "d1",
      type: "deadline",
      title: "Task due tomorrow",
      body: `${String(task.title || "Task")} — due ${formatDueDate(dueKey)}`,
      id: `deadline-${String(task.id)}-d1-${dueKey}`
    };
  }

  if (difference === 0) {
    return {
      kind: "d0",
      type: "deadline",
      title: "Task due today",
      body: `${String(task.title || "Task")} — due today`,
      id: `deadline-${String(task.id)}-d0-${dueKey}`
    };
  }

  if (difference < 0) {
    const daysOverdue = Math.abs(difference);
    return {
      kind: "overdue",
      type: "overdue",
      title: "Task overdue",
      body: `${String(task.title || "Task")} — ${daysOverdue} day(s) overdue`,
      id: `deadline-${String(task.id)}-overdue-${todayKey}`
    };
  }

  return null;
}

async function writeNotificationChunks(notifications) {
  let written = 0;

  for (let start = 0; start < notifications.length; start += BATCH_LIMIT) {
    const chunk = notifications.slice(start, start + BATCH_LIMIT);
    const batch = db.batch();

    for (const notification of chunk) {
      const ref = db.doc(`users/${notification.recipientUid}/notifications/${notification.id}`);
      batch.set(ref, notification, { merge: false });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

exports.generateDeadlineNotifications = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: TIME_ZONE,
    retryCount: 1
  },
  async () => {
    const todayKey = dateKeyFromNow();
    const tasksSnapshot = await db.collection("tasks").get();

    const candidates = [];
    const memberCache = new Map();

    for (const taskDoc of tasksSnapshot.docs) {
      const task = {
        ...taskDoc.data(),
        id: String(taskDoc.id)
      };

      const plan = notificationPlanForTask(task, todayKey);
      const assignee = String(task.assignee || "").trim();

      if (!plan || !assignee) {
        continue;
      }

      let member = memberCache.get(assignee);
      if (member === undefined) {
        const memberSnapshot = await db.doc(`members/${assignee}`).get();
        member = memberSnapshot.exists ? memberSnapshot.data() : null;
        memberCache.set(assignee, member);
      }

      const recipientUid = String(member?.authUid || "").trim();
      if (!recipientUid) {
        logger.warn("Skipping deadline notification: assignee has no authUid", {
          taskId: task.id,
          assignee
        });
        continue;
      }

      const notificationRef = db.doc(
        `users/${recipientUid}/notifications/${plan.id}`
      );
      const existing = await notificationRef.get();

      if (existing.exists) {
        continue;
      }

      const now = new Date().toISOString();

      candidates.push({
        id: plan.id,
        userId: assignee,
        recipientUid,
        recipientMemberId: assignee,
        type: plan.type,
        priority: "normal",
        title: plan.title,
        body: plan.body,
        taskId: task.id,
        commentId: null,
        sourceType: "deadline",
        sourceId: plan.id,
        sourceEvent: plan.kind,
        actorUid: null,
        actorMemberId: "system",
        actorName: "Task Board",
        read: false,
        at: now,
        createdAt: now,
        updatedAt: now,
        legacy: false,
        deliverySource: "server-scheduler"
      });
    }

    const written = await writeNotificationChunks(candidates);

    logger.info("Deadline notification scheduler completed", {
      todayKey,
      tasksScanned: tasksSnapshot.size,
      candidates: candidates.length,
      written
    });
  }
);


// -----------------------------------------------------------------------------
// Account lifecycle: deactivate/reactivate, permanent offboarding, re-onboarding.
// All privileged changes run with Admin SDK and require an active All Access caller.
// -----------------------------------------------------------------------------

const adminAuth = getAuth();

function accountCallableError(code, message) {
  return new HttpsError(code, message);
}

function cleanPathId(value, label = "Member ID") {
  const id = String(value || "").trim();
  if (!id || id.includes("/") || id.length > 180) {
    throw accountCallableError("invalid-argument", `${label} tidak valid.`);
  }
  return id;
}

function requireEmail(value) {
  const email = String(value || "").trim();
  if (!email || email.includes("/") || !email.includes("@")) {
    throw accountCallableError("failed-precondition", "Akun ini tidak memiliki email Google yang valid.");
  }
  return email;
}

async function requireAllAccessCaller(request) {
  if (!request.auth?.uid) {
    throw accountCallableError("unauthenticated", "Silakan login terlebih dahulu.");
  }
  const callerRef = db.doc(`users/${request.auth.uid}`);
  const callerSnapshot = await callerRef.get();
  if (!callerSnapshot.exists) {
    throw accountCallableError("permission-denied", "Profil All Access tidak ditemukan.");
  }
  const callerProfile = callerSnapshot.data() || {};
  const authTime = Number(request.auth.token?.auth_time || 0);
  if (callerProfile.accessLevel !== "all"
      || ["inactive", "removed"].includes(callerProfile.accountStatus)
      || (Number(callerProfile.requireAuthAfter || 0) > 0 && authTime < Number(callerProfile.requireAuthAfter))) {
    throw accountCallableError("permission-denied", "Hanya akun All Access yang aktif yang dapat mengelola akun.");
  }
  return { uid: request.auth.uid, profile: callerProfile };
}

async function getManagedTarget(memberId, callerUid) {
  const memberRef = db.doc(`members/${memberId}`);
  const memberSnapshot = await memberRef.get();
  if (!memberSnapshot.exists) {
    throw accountCallableError("not-found", "Member tidak ditemukan.");
  }
  const member = memberSnapshot.data() || {};
  const targetUid = String(member.authUid || "").trim();
  if (targetUid && targetUid === callerUid) {
    throw accountCallableError("failed-precondition", "All Access tidak dapat menonaktifkan atau menghapus akunnya sendiri.");
  }

  const profileRef = targetUid ? db.doc(`users/${targetUid}`) : null;
  const profileSnapshot = profileRef ? await profileRef.get() : null;
  const profile = profileSnapshot?.exists ? (profileSnapshot.data() || {}) : null;
  if (profile?.accessLevel === "all" || member.accessLevel === "all") {
    throw accountCallableError("failed-precondition", "Akun All Access harus dikelola melalui prosedur administrator khusus.");
  }

  return { memberRef, member, memberId, targetUid, profileRef, profile, profileSnapshot };
}

function accountProfileArchive(profile) {
  if (!profile) return null;
  const allowed = [
    "username", "email", "role", "accessLevel", "department", "departmentStatus",
    "profileCompleted", "profilePhotoMeta", "profilePhotoPosition", "createdAt",
    "updatedAt", "accountStatus", "requireAuthAfter"
  ];
  const result = {};
  for (const key of allowed) {
    if (profile[key] !== undefined) result[key] = profile[key];
  }
  return result;
}

function memberArchiveSnapshot(member) {
  const result = { ...member };
  // Large inline image data is unnecessary for task-history identity and can
  // make archive documents unnecessarily large.
  delete result.profilePhoto;
  delete result.profilePhotoMeta;
  delete result.authUid;
  return result;
}

async function deleteUserNotifications(uid) {
  if (!uid) return;
  const notificationsRef = db.collection(`users/${uid}/notifications`);
  while (true) {
    const snapshot = await notificationsRef.limit(450).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((notification) => batch.delete(notification.ref));
    await batch.commit();
    if (snapshot.size < 450) break;
  }
}

async function deleteAuthIdentityIfPresent(uid) {
  if (!uid) return;
  try {
    await adminAuth.updateUser(uid, { disabled: true });
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
    return;
  }
  try {
    await adminAuth.revokeRefreshTokens(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }
  try {
    await adminAuth.deleteUser(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }
}

exports.getAccountOnboardingState = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw accountCallableError("unauthenticated", "Silakan login terlebih dahulu.");
  }
  if (request.auth.token?.email_verified !== true) {
    throw accountCallableError("failed-precondition", "Gunakan akun Google dengan email terverifikasi.");
  }
  const email = requireEmail(request.auth.token.email);
  const restrictionSnapshot = await db.doc(`restrictedAccounts/${email}`).get();
  if (!restrictionSnapshot.exists) return { status: "none" };
  const status = String(restrictionSnapshot.data()?.status || "blocked");
  if (status === "approved") return { status: "approved" };
  return { status: "blocked" };
});

exports.setManagedAccountStatus = onCall(async (request) => {
  const caller = await requireAllAccessCaller(request);
  const memberId = cleanPathId(request.data?.memberId);
  const desiredStatus = String(request.data?.accountStatus || "");
  if (!['active', 'inactive'].includes(desiredStatus)) {
    throw accountCallableError("invalid-argument", "Status akun harus active atau inactive.");
  }

  const target = await getManagedTarget(memberId, caller.uid);
  if (target.member.accountStatus === "removed" || target.member.archived === true) {
    throw accountCallableError("failed-precondition", "Akun yang sudah dihapus permanen tidak bisa diaktifkan lewat kontrol ini. Gunakan Allow Re-onboarding.");
  }
  if (!target.targetUid || !target.profileRef || !target.profileSnapshot?.exists) {
    throw accountCallableError("failed-precondition", "Member ini belum terhubung ke akun login Google.");
  }
  if (desiredStatus === String(target.member.accountStatus || "active")) {
    if (desiredStatus === "inactive" && target.member.authCleanupPending === true && target.targetUid) {
      let retryPending = false;
      try {
        await adminAuth.updateUser(target.targetUid, { disabled: true });
        await adminAuth.revokeRefreshTokens(target.targetUid);
      } catch (error) {
        retryPending = true;
        logger.error("Retry for Firebase Authentication deactivation failed", { memberId, code: error?.code || "unknown" });
      }
      await target.memberRef.update({
        authCleanupPending: retryPending,
        authCleanupLastError: retryPending ? "Firebase Authentication disable/revoke needs retry" : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
      return { ok: true, accountStatus: "inactive", unchanged: true, authCleanupPending: retryPending };
    }
    return { ok: true, accountStatus: desiredStatus, unchanged: true, authCleanupPending: target.member.authCleanupPending === true };
  }

  const userRef = target.profileRef;
  const now = FieldValue.serverTimestamp();

  if (desiredStatus === "inactive") {
    const wasRosterActive = target.member.rosterActiveBeforeDeactivation !== undefined
      ? target.member.rosterActiveBeforeDeactivation === true
      : target.member.active !== false;
    const requireAuthAfter = Math.floor(Date.now() / 1000) + 1;
    await db.runTransaction(async (transaction) => {
      const [freshMemberSnap, freshProfileSnap] = await Promise.all([
        transaction.get(target.memberRef), transaction.get(userRef)
      ]);
      if (!freshMemberSnap.exists || !freshProfileSnap.exists) {
        throw accountCallableError("not-found", "Profil member atau akun tidak ditemukan.");
      }
      const freshProfile = freshProfileSnap.data() || {};
      if (freshProfile.accessLevel === "all") {
        throw accountCallableError("failed-precondition", "Akun All Access tidak dapat dinonaktifkan melalui tindakan ini.");
      }
      transaction.update(userRef, {
        accountStatus: "inactive",
        requireAuthAfter,
        accountStatusUpdatedAt: now,
        updatedAt: now
      });
      transaction.update(target.memberRef, {
        accountStatus: "inactive",
        active: false,
        rosterActiveBeforeDeactivation: wasRosterActive,
        authCleanupPending: true,
        accountStatusUpdatedAt: now,
        updatedAt: now
      });
    });

    let authCleanupPending = false;
    try {
      await adminAuth.updateUser(target.targetUid, { disabled: true });
      await adminAuth.revokeRefreshTokens(target.targetUid);
    } catch (error) {
      authCleanupPending = true;
      logger.error("Account marked inactive in Firestore, but Auth disable/revoke needs retry", {
        memberId, targetUid: target.targetUid, code: error?.code || "unknown"
      });
    }
    await target.memberRef.update({
      authCleanupPending,
      authCleanupLastError: authCleanupPending ? "Firebase Authentication disable/revoke needs retry" : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { ok: true, accountStatus: "inactive", authCleanupPending };
  }

  // Reactivation allows future sign-in, but requireAuthAfter stays on the profile
  // so any browser session from before deactivation must sign out and sign in again.
  try {
    await adminAuth.updateUser(target.targetUid, { disabled: false });
  } catch (error) {
    logger.error("Cannot re-enable Firebase Authentication user", { memberId, code: error?.code || "unknown" });
    throw accountCallableError("internal", "Firebase Authentication gagal mengaktifkan akun. Status workspace belum dibuka kembali.");
  }
  const restoreRosterActive = target.member.rosterActiveBeforeDeactivation !== false;
  await db.runTransaction(async (transaction) => {
    const [freshMemberSnap, freshProfileSnap] = await Promise.all([
      transaction.get(target.memberRef), transaction.get(userRef)
    ]);
    if (!freshMemberSnap.exists || !freshProfileSnap.exists) {
      throw accountCallableError("not-found", "Profil member atau akun tidak ditemukan.");
    }
    const freshProfile = freshProfileSnap.data() || {};
    if (freshProfile.accessLevel === "all" || freshProfile.accountStatus === "removed") {
      throw accountCallableError("failed-precondition", "Akun ini tidak bisa diaktifkan melalui tindakan ini.");
    }
    transaction.update(userRef, {
      accountStatus: "active",
      accountStatusUpdatedAt: now,
      updatedAt: now
    });
    transaction.update(target.memberRef, {
      accountStatus: "active",
      active: restoreRosterActive,
      rosterActiveBeforeDeactivation: FieldValue.delete(),
      authCleanupPending: false,
      authCleanupLastError: FieldValue.delete(),
      accountStatusUpdatedAt: now,
      updatedAt: now
    });
  });
  return { ok: true, accountStatus: "active", reauthenticationRequired: true };
});

exports.permanentlyRemoveAccount = onCall(async (request) => {
  const caller = await requireAllAccessCaller(request);
  const memberId = cleanPathId(request.data?.memberId);
  const target = await getManagedTarget(memberId, caller.uid);
  const memberArchiveRef = db.doc(`memberArchives/${memberId}`);
  const existingArchiveSnap = await memberArchiveRef.get();
  const existingArchive = existingArchiveSnap.exists ? (existingArchiveSnap.data() || {}) : {};

  let oldUid = String(target.targetUid || existingArchive.oldAuthUid || "").trim();
  let oldProfile = target.profile;
  if (!oldProfile && oldUid) {
    const oldProfileSnap = await db.doc(`users/${oldUid}`).get();
    oldProfile = oldProfileSnap.exists ? (oldProfileSnap.data() || {}) : null;
  }
  let email = String(existingArchive.email || oldProfile?.email || target.member.email || "").trim();
  if (oldUid) {
    try {
      const authUser = await adminAuth.getUser(oldUid);
      if (authUser.email) email = authUser.email;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  email = requireEmail(email);
  if (!target.memberRef || (!target.profile && !existingArchiveSnap.exists && !oldUid)) {
    throw accountCallableError("failed-precondition", "Akun login belum terhubung atau arsip lama tidak ditemukan.");
  }

  const restrictionRef = db.doc(`restrictedAccounts/${email}`);
  const alreadyRemoved = target.member.accountStatus === "removed" || target.member.archived === true;
  if (!alreadyRemoved) {
    const memberSnapshot = memberArchiveSnapshot(target.member);
    const profileSnapshot = accountProfileArchive(oldProfile);
    const archiveData = {
      memberId,
      email,
      oldAuthUid: oldUid || null,
      memberSnapshot,
      profileSnapshot,
      status: "removed",
      reOnboardingStatus: "blocked",
      removedByUid: caller.uid,
      removedAt: FieldValue.serverTimestamp(),
      cleanupPending: true
    };
    await db.runTransaction(async (transaction) => {
      const [freshMemberSnap, freshProfileSnap] = await Promise.all([
        transaction.get(target.memberRef),
        oldUid ? transaction.get(db.doc(`users/${oldUid}`)) : Promise.resolve(null)
      ]);
      if (!freshMemberSnap.exists) throw accountCallableError("not-found", "Member tidak ditemukan.");
      const freshMember = freshMemberSnap.data() || {};
      if (freshMember.accountStatus === "removed" || freshMember.archived === true) {
        throw accountCallableError("aborted", "Akun ini sudah dalam proses penghapusan. Gunakan Retry cleanup.");
      }
      if (freshProfileSnap?.exists && freshProfileSnap.data()?.accessLevel === "all") {
        throw accountCallableError("failed-precondition", "Akun All Access tidak dapat dihapus melalui tindakan ini.");
      }
      transaction.set(memberArchiveRef, archiveData, { merge: true });
      transaction.set(restrictionRef, {
        email,
        memberId,
        status: "blocked",
        reason: "permanently-removed",
        removedAt: FieldValue.serverTimestamp(),
        removedByUid: caller.uid
      }, { merge: true });
      transaction.update(target.memberRef, {
        accountStatus: "removed",
        active: false,
        archived: true,
        reOnboardingStatus: "blocked",
        cleanupPending: true,
        authCleanupLastError: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      });
      if (oldUid && freshProfileSnap?.exists) {
        transaction.delete(db.doc(`users/${oldUid}`));
      }
    });
  } else {
    // Heal missing block state if an earlier attempt stopped after archival.
    await restrictionRef.set({
      email, memberId, status: "blocked", reason: "permanently-removed",
      removedAt: existingArchive.removedAt || FieldValue.serverTimestamp(),
      removedByUid: existingArchive.removedByUid || caller.uid
    }, { merge: true });
  }

  const cleanupErrors = [];
  try {
    if (oldUid) await deleteUserNotifications(oldUid);
  } catch (error) {
    cleanupErrors.push(`notifications:${error?.code || "unknown"}`);
    logger.error("Could not purge removed user's personal notifications", { memberId, oldUid, code: error?.code || "unknown" });
  }
  try {
    if (oldUid) await deleteAuthIdentityIfPresent(oldUid);
  } catch (error) {
    cleanupErrors.push(`auth:${error?.code || "unknown"}`);
    logger.error("Could not fully delete removed Firebase Auth identity", { memberId, oldUid, code: error?.code || "unknown" });
  }

  const cleanupPending = cleanupErrors.length > 0;
  const updatePayload = {
    cleanupPending,
    authCleanupLastError: cleanupPending ? cleanupErrors.join(", ") : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp()
  };
  if (!cleanupPending) updatePayload.authUid = FieldValue.delete();
  await target.memberRef.update(updatePayload);
  await memberArchiveRef.set({
    cleanupPending,
    authDeletedAt: cleanupPending ? null : FieldValue.serverTimestamp(),
    cleanupErrors: cleanupPending ? cleanupErrors : FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    accountStatus: "removed",
    cleanupPending,
    message: cleanupPending
      ? "Akses workspace sudah diblokir. Sebagian cleanup membutuhkan retry sebelum re-onboarding diizinkan."
      : "Akun login dihapus, akses diblokir, dan identitas task lama disimpan sebagai arsip."
  };
});

exports.allowAccountReonboarding = onCall(async (request) => {
  const caller = await requireAllAccessCaller(request);
  const memberId = cleanPathId(request.data?.memberId);
  const memberRef = db.doc(`members/${memberId}`);
  const archiveRef = db.doc(`memberArchives/${memberId}`);
  const memberSnapshot = await memberRef.get();
  const archiveSnapshot = await archiveRef.get();
  if (!memberSnapshot.exists || !archiveSnapshot.exists) {
    throw accountCallableError("not-found", "Arsip akun tidak ditemukan.");
  }
  const member = memberSnapshot.data() || {};
  const archive = archiveSnapshot.data() || {};
  if (member.accountStatus !== "removed" || archive.status !== "removed") {
    throw accountCallableError("failed-precondition", "Hanya akun yang sudah dihapus permanen yang bisa disetujui untuk re-onboarding.");
  }
  if (member.cleanupPending === true || archive.cleanupPending === true) {
    throw accountCallableError("failed-precondition", "Selesaikan Retry cleanup sebelum menyetujui re-onboarding.");
  }
  const email = requireEmail(archive.email || member.email);
  await db.doc(`restrictedAccounts/${email}`).set({
    email, memberId, status: "approved", approvedByUid: caller.uid,
    approvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await Promise.all([
    memberRef.update({ reOnboardingStatus: "approved", reOnboardingApprovedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }),
    archiveRef.set({ reOnboardingStatus: "approved", reOnboardingApprovedByUid: caller.uid, reOnboardingApprovedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  ]);
  return { ok: true, status: "approved", email };
});

exports.consumeAccountReonboardingApproval = onCall(async (request) => {
  if (!request.auth?.uid) throw accountCallableError("unauthenticated", "Silakan login terlebih dahulu.");
  if (request.auth.token?.email_verified !== true) throw accountCallableError("failed-precondition", "Gunakan email yang terverifikasi.");
  const uid = request.auth.uid;
  const email = requireEmail(request.auth.token.email);
  if (request.data?.uid && String(request.data.uid) !== uid) {
    throw accountCallableError("permission-denied", "UID tidak cocok dengan sesi login.");
  }
  const userRef = db.doc(`users/${uid}`);
  const profileSnapshot = await userRef.get();
  if (!profileSnapshot.exists) throw accountCallableError("failed-precondition", "Profil baru belum tersimpan.");
  const profile = profileSnapshot.data() || {};
  if (profile.email !== email || profile.accountStatus !== "active" || profile.departmentStatus !== "pending") {
    throw accountCallableError("permission-denied", "Profil belum memenuhi syarat penyelesaian re-onboarding.");
  }
  const restrictionRef = db.doc(`restrictedAccounts/${email}`);
  const restrictionSnapshot = await restrictionRef.get();
  if (!restrictionSnapshot.exists) return { ok: true, status: "none" };
  const restriction = restrictionSnapshot.data() || {};
  if (restriction.status !== "approved") {
    throw accountCallableError("permission-denied", "Email ini belum disetujui untuk re-onboarding.");
  }
  const oldMemberId = String(restriction.memberId || "").trim();
  const batch = db.batch();
  batch.delete(restrictionRef);
  if (oldMemberId) {
    batch.set(db.doc(`members/${oldMemberId}`), {
      reOnboardingStatus: "completed",
      reOnboardingUid: uid,
      reOnboardingCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(db.doc(`memberArchives/${oldMemberId}`), {
      reOnboardingStatus: "completed",
      reOnboardingUid: uid,
      reOnboardingCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
  return { ok: true, status: "consumed" };
});
