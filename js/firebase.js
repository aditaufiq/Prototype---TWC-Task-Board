import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  limit,
  where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBUuyZ-Xr7winuUBA-t1hIKe3eVXnGA_Zw",
  authDomain: "twc-monitoring.firebaseapp.com",
  projectId: "twc-monitoring",
  storageBucket: "twc-monitoring.firebasestorage.app",
  messagingSenderId: "856037018509",
  appId: "1:856037018509:web:a3a5065a1458d5ba384bc4"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: 'select_account'
});

async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);

    const user = result.user;

    console.log("Google login berhasil!");
    console.log("Nama:", user.displayName);
    console.log("Email:", user.email);
    console.log("UID:", user.uid);

    return user;
  } catch (error) {
    console.error("Google login gagal:", error);
    throw error;
  }
}

async function getUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data();
}

async function getMember(memberId) {
  const memberRef = doc(db, "members", String(memberId));
  const snapshot = await getDoc(memberRef);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    ...snapshot.data(),
    id: String(snapshot.id)
  };
}

function subscribeToMembers(onChange, onError) {
  const membersRef = collection(db, "members");

  return onSnapshot(
    membersRef,
    snapshot => {
      const members = snapshot.docs.map(docSnap => ({
        ...docSnap.data(),
        id: String(docSnap.id)
      }));

      onChange(members, snapshot);
    },
    error => {
      console.error("Realtime members listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

async function saveMember(member) {
  const memberId = String(member?.id || '').trim();

  if (!memberId) {
    throw new Error("Member ID tidak boleh kosong.");
  }

  const memberRef = doc(db, "members", memberId);

  await setDoc(memberRef, {
    ...member,
    id: memberId,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  return getMember(memberId);
}

async function deleteMember(memberId) {
  const memberRef = doc(db, "members", String(memberId));
  await deleteDoc(memberRef);
}

function subscribeToProducts(onChange, onError) {
  const productsRef = collection(db, "products");

  return onSnapshot(
    productsRef,
    snapshot => {
      const products = {};

      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data() || {};

        products[String(docSnap.id)] = Array.isArray(data.items)
          ? data.items.map(item => String(item)).filter(Boolean)
          : [];
      });

      onChange(products, snapshot);
    },
    error => {
      console.error("Realtime products listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

async function saveProductGroup(divisionId, items) {
  const id = String(divisionId || '').trim();

  if (!id) {
    throw new Error("Division ID product tidak boleh kosong.");
  }

  const normalizedItems = Array.isArray(items)
    ? items.map(item => String(item).trim()).filter(Boolean)
    : [];

  const productRef = doc(db, "products", id);

  await setDoc(
    productRef,
    {
      divisionId: id,
      items: normalizedItems,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );

  return normalizedItems;
}

async function seedProductGroupIfMissing(divisionId, items) {
  const id = String(divisionId || '').trim();

  if (!id) {
    throw new Error("Division ID product tidak boleh kosong.");
  }

  const normalizedItems = Array.isArray(items)
    ? items.map(item => String(item).trim()).filter(Boolean)
    : [];

  const productRef = doc(db, "products", id);

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(productRef);

    if (snapshot.exists()) {
      return;
    }

    transaction.set(productRef, {
      divisionId: id,
      items: normalizedItems,
      updatedAt: new Date().toISOString()
    });
  });

  return normalizedItems;
}

async function saveProductGroupAndTasks(divisionId, items, tasks) {
  const id = String(divisionId || '').trim();

  if (!id) {
    throw new Error("Division ID product tidak boleh kosong.");
  }

  const normalizedItems = Array.isArray(items)
    ? items.map(item => String(item).trim()).filter(Boolean)
    : [];

  const batch = writeBatch(db);
  const productRef = doc(db, "products", id);

  batch.set(
    productRef,
    {
      divisionId: id,
      items: normalizedItems,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );

  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (!task?.id) continue;

      const taskRef = doc(db, "tasks", String(task.id));

      batch.update(taskRef, {
        ...task,
        updatedAt: task.updatedAt || new Date().toISOString()
      });
    }
  }

  await batch.commit();

  return {
    divisionId: id,
    items: normalizedItems,
    tasks: Array.isArray(tasks) ? tasks : []
  };
}

async function getAllComments() {
  const snapshot = await getDocs(collection(db, "comments"));
  return snapshot.docs.map(docSnap => ({
    ...docSnap.data(),
    id: String(docSnap.id)
  }));
}

function subscribeToComments(taskId, onChange, onError) {
  const normalizedTaskId = String(taskId || '').trim();

  if (!normalizedTaskId) {
    throw new Error("Task ID komentar tidak boleh kosong.");
  }

  // Filter by taskId only. We sort client-side to avoid requiring
  // a composite Firestore index for taskId + createdAt.
  const commentsQuery = query(
    collection(db, "comments"),
    where("taskId", "==", normalizedTaskId)
  );

  return onSnapshot(
    commentsQuery,
    snapshot => {
      const comments = snapshot.docs
        .map(docSnap => ({
          ...docSnap.data(),
          id: String(docSnap.id),
          taskId: String(docSnap.data()?.taskId || normalizedTaskId)
        }))
        .sort((a, b) => new Date(a.at || a.createdAt || 0) - new Date(b.at || b.createdAt || 0));

      onChange(comments, snapshot);
    },
    error => {
      console.error("Realtime comments listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

async function addComment(comment) {
  const commentId = String(
    comment?.id || `comment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
  const commentRef = doc(db, "comments", commentId);
  const now = new Date().toISOString();

  const payload = {
    ...comment,
    id: commentId,
    taskId: String(comment?.taskId || ''),
    authorId: String(comment?.authorId || ''),
    authorName: comment?.authorName || "Unknown",
    authorUid: comment?.authorUid || null,
    text: String(comment?.text || '').trim(),
    at: comment?.at || now,
    createdAt: comment?.createdAt || now,
    replyToId: comment?.replyToId ? String(comment.replyToId) : null,
    mentions: Array.isArray(comment?.mentions)
      ? comment.mentions.map(id => String(id)).filter(Boolean)
      : [],
    legacy: comment?.legacy === true,
    migratedFromLocal: comment?.migratedFromLocal === true,
    migratedByUid: comment?.migratedByUid || null
  };

  if (!payload.taskId || !payload.text) {
    throw new Error("Comment membutuhkan taskId dan text.");
  }

  if (!payload.authorUid && !payload.legacy) {
    throw new Error("Comment non-legacy membutuhkan authorUid.");
  }

  await setDoc(commentRef, payload);
  return payload;
}

function subscribeToActivities(onChange, onError) {
  const activitiesQuery = query(
    collection(db, "activities"),
    orderBy("at", "desc"),
    limit(200)
  );

  return onSnapshot(
    activitiesQuery,
    snapshot => {
      const activities = snapshot.docs.map(docSnap => ({
        ...docSnap.data(),
        id: String(docSnap.id)
      }));

      onChange(activities, snapshot);
    },
    error => {
      console.error("Realtime activities listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

async function addActivity(activity) {
  const activityId = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const activityRef = doc(db, "activities", activityId);

  const payload = {
    ...activity,
    id: activityId,
    entityType: activity.entityType || (activity.taskId ? "task" : "workspace"),
    entityId: activity.entityId == null
      ? (activity.taskId == null ? null : String(activity.taskId))
      : String(activity.entityId),
    taskId: activity.taskId == null ? null : String(activity.taskId),
    actorId: activity.actorId || null,
    actorName: activity.actorName || "Unknown",
    actorUid: activity.actorUid || null,
    action: activity.action || "update",
    detail: activity.detail || "",
    at: activity.at || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    legacy: activity.legacy === true,
    migratedFromLocal: activity.migratedFromLocal === true,
    migratedByUid: activity.migratedByUid || null
  };

  await setDoc(activityRef, payload);
  return payload;
}

function subscribeToNotifications(userUid, onChange, onError) {
  const uid = String(userUid || '').trim();
  if (!uid) throw new Error("User UID notification tidak boleh kosong.");

  const notificationsRef = collection(db, "users", uid, "notifications");

  return onSnapshot(
    notificationsRef,
    snapshot => {
      const notifications = snapshot.docs
        .map(docSnap => ({
          ...docSnap.data(),
          id: String(docSnap.id)
        }))
        .sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0))
        .slice(0, 3000);

      onChange(notifications, snapshot);
    },
    error => {
      console.error("Realtime personal notifications listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

async function addNotificationForUser(userUid, notification, notificationId = null) {
  const uid = String(userUid || '').trim();
  if (!uid) throw new Error("Recipient UID notification tidak boleh kosong.");

  const id = String(
    notificationId ||
    notification?.id ||
    `notification-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );

  const notificationRef = doc(db, "users", uid, "notifications", id);
  const now = new Date().toISOString();

  const payload = {
    ...notification,
    recipientUid: uid,
    id,
    type: notification?.type || 'message',
    priority: notification?.priority || (notification?.type === 'mention' ? 'high' : 'normal'),
    title: notification?.title || 'Notification',
    body: String(notification?.body || ''),
    taskId: notification?.taskId == null ? null : String(notification.taskId),
    commentId: notification?.commentId == null ? null : String(notification.commentId),
    sourceType: notification?.sourceType || 'self',
    sourceId: notification?.sourceId == null ? null : String(notification.sourceId),
    read: notification?.read === true,
    at: notification?.at || now,
    createdAt: notification?.createdAt || now,
    updatedAt: now
  };

  await setDoc(notificationRef, payload, { merge: true });
  return payload;
}

async function addCommentWithNotifications(comment, notificationRequests = []) {
  const commentId = String(
    comment?.id || `comment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
  const commentRef = doc(db, "comments", commentId);
  const now = new Date().toISOString();

  const commentPayload = {
    ...comment,
    id: commentId,
    taskId: String(comment?.taskId || ''),
    authorId: String(comment?.authorId || ''),
    authorName: comment?.authorName || "Unknown",
    authorUid: comment?.authorUid || null,
    text: String(comment?.text || '').trim(),
    at: comment?.at || now,
    createdAt: comment?.createdAt || now,
    replyToId: comment?.replyToId ? String(comment.replyToId) : null,
    mentions: Array.isArray(comment?.mentions)
      ? comment.mentions.map(id => String(id)).filter(Boolean)
      : [],
    legacy: comment?.legacy === true,
    migratedFromLocal: comment?.migratedFromLocal === true,
    migratedByUid: comment?.migratedByUid || null
  };

  if (!commentPayload.taskId || !commentPayload.text) {
    throw new Error("Comment membutuhkan taskId dan text.");
  }

  if (!commentPayload.authorUid && !commentPayload.legacy) {
    throw new Error("Comment non-legacy membutuhkan authorUid.");
  }

  const batch = writeBatch(db);
  batch.set(commentRef, commentPayload);

  const seenRecipients = new Set();

  for (const request of Array.isArray(notificationRequests) ? notificationRequests : []) {
    const recipientUid = String(request?.recipientUid || '').trim();
    const recipientMemberId = String(request?.recipientMemberId || '').trim();

    if (!recipientUid || !recipientMemberId || recipientUid === commentPayload.authorUid) continue;
    if (seenRecipients.has(recipientUid)) continue;

    seenRecipients.add(recipientUid);

    const notificationId = `comment-${commentId}-${recipientMemberId}`;
    const notificationRef = doc(
      db,
      "users",
      recipientUid,
      "notifications",
      notificationId
    );

    batch.set(notificationRef, {
      id: notificationId,
      recipientUid,
      recipientMemberId,
      type: request.type || 'message',
      priority: request.priority || (request.type === 'mention' ? 'high' : 'normal'),
      title: request.title || 'New task activity',
      body: String(request.body || ''),
      taskId: commentPayload.taskId,
      commentId,
      sourceType: 'comment',
      sourceId: commentId,
      actorUid: commentPayload.authorUid,
      actorMemberId: commentPayload.authorId,
      actorName: commentPayload.authorName,
      read: false,
      at: commentPayload.at,
      createdAt: now,
      updatedAt: now,
      legacy: false
    });
  }

  await batch.commit();
  return commentPayload;
}

async function markNotificationRead(userUid, notificationId) {
  const uid = String(userUid || '').trim();
  const id = String(notificationId || '').trim();
  if (!uid || !id) throw new Error("Notification user/id tidak boleh kosong.");

  const notificationRef = doc(db, "users", uid, "notifications", id);
  await updateDoc(notificationRef, {
    read: true,
    readAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

async function markAllNotificationsRead(userUid, unreadNotifications = []) {
  const uid = String(userUid || '').trim();
  if (!uid) throw new Error("User UID notification tidak boleh kosong.");

  const pending = (Array.isArray(unreadNotifications) ? unreadNotifications : [])
    .filter(notification => notification && !notification.read && notification.id);

  if (!pending.length) return;

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  for (const notification of pending) {
    const notificationRef = doc(db, "users", uid, "notifications", String(notification.id));
    batch.update(notificationRef, {
      read: true,
      readAt: now,
      updatedAt: now
    });
  }

  await batch.commit();
}

async function createUserProfile(uid, profileData) {
  const userRef = doc(db, "users", uid);

  await setDoc(userRef, {
    ...profileData,
    updatedAt: new Date().toISOString()
  });

  return getUserProfile(uid);
}

async function getTasks() {
  const tasksRef = collection(db, "tasks");
  const snapshot = await getDocs(tasksRef);

  return snapshot.docs.map(docSnap => docSnap.data());
}

function subscribeToTasks(onChange, onError) {
  const tasksRef = collection(db, "tasks");

  return onSnapshot(
    tasksRef,
    snapshot => {
      const tasks = snapshot.docs.map(docSnap => ({
        ...docSnap.data(),
        id: String(docSnap.id)
      }));

      onChange(tasks, snapshot);
    },
    error => {
      console.error("Realtime tasks listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

function currentAuthUid() {
  return auth.currentUser?.uid || null;
}

function addTaskEventNotificationsToBatch(batch, taskId, notificationRequests, actorUid) {
  const requests = Array.isArray(notificationRequests) ? notificationRequests : [];
  const now = new Date().toISOString();
  const seen = new Set();

  for (const request of requests) {
    const recipientUid = String(request?.recipientUid || '').trim();
    const recipientMemberId = String(request?.recipientMemberId || '').trim();
    if (!recipientUid || !recipientMemberId || !actorUid) continue;
    if (recipientUid === String(actorUid)) continue;
    if (request?.sourceType !== 'taskEvent') continue;
    if (seen.has(recipientUid)) continue;
    seen.add(recipientUid);

    const eventAt = request.eventAt || now;
    const event = request.sourceEvent || request.type || 'update';
    const actualTaskId = String(taskId);
    const notificationId = `task-${actualTaskId}-${String(event)}-${String(eventAt).replace(/[^0-9A-Za-z]/g, '')}-${recipientMemberId}`;
    const notificationRef = doc(db, 'users', recipientUid, 'notifications', notificationId);

    batch.set(notificationRef, {
      id: notificationId,
      recipientUid,
      recipientMemberId,
      type: request.type || 'review',
      priority: request.priority || 'normal',
      title: request.title || 'Task update',
      body: String(request.body || ''),
      taskId: actualTaskId,
      commentId: null,
      sourceType: 'taskEvent',
      sourceId: actualTaskId,
      sourceEvent: event,
      actorUid: String(actorUid),
      actorMemberId: request.actorMemberId || null,
      actorName: request.actorName || null,
      read: false,
      at: eventAt,
      createdAt: now,
      updatedAt: now,
      legacy: false
    });
  }
}

async function addTask(task, notificationRequests = []) {
  const counterRef = doc(db, "counters", "tasks");

  const nextNumber = await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);

    const currentNumber = counterSnap.exists()
      ? Number(counterSnap.data().lastNumber || 0)
      : 0;

    const next = currentNumber + 1;

    transaction.set(
      counterRef,
      {
        lastNumber: next,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );

    return next;
  });

  const taskId = `task-${String(nextNumber).padStart(3, "0")}`;
  task.id = taskId;

  const taskRef = doc(db, "tasks", taskId);
  const actorUid = currentAuthUid();
  const now = new Date().toISOString();

  const batch = writeBatch(db);
  batch.set(taskRef, {
    ...task,
    createdByUid: task.createdByUid || actorUid,
    updatedByUid: actorUid,
    updatedAt: task.updatedAt || now
  });

  addTaskEventNotificationsToBatch(batch, taskId, notificationRequests, actorUid, task.createdByUid || actorUid);

  await batch.commit();

  console.log("✅ Task berhasil disimpan ke Firestore:", task);
  return task;
}

async function updateTask(taskId, taskData, notificationRequests = []) {
  const taskRef = doc(db, "tasks", String(taskId));
  const actorUid = currentAuthUid();
  const now = new Date().toISOString();

  const batch = writeBatch(db);
  batch.update(taskRef, {
    ...taskData,
    updatedByUid: actorUid,
    updatedAt: taskData.updatedAt || now
  });

  addTaskEventNotificationsToBatch(batch, String(taskId), notificationRequests, actorUid);

  await batch.commit();
  return taskData;
}

async function updateTasksBatch(tasks, notificationRequests = []) {
  const batch = writeBatch(db);
  const now = new Date().toISOString();

  for (const task of tasks) {
    const taskRef = doc(db, "tasks", String(task.id));
    batch.update(taskRef, {
      ...task,
      updatedByUid: currentAuthUid(),
      updatedAt: task.updatedAt || now
    });
  }

  const actorUid = currentAuthUid();
  const seenNotificationKeys = new Set();
  for (const request of Array.isArray(notificationRequests) ? notificationRequests : []) {
    const recipientUid = String(request?.recipientUid || '').trim();
    const recipientMemberId = String(request?.recipientMemberId || '').trim();
    const taskId = String(request?.taskId || '');
    if (!recipientUid || !recipientMemberId || !taskId || !actorUid) continue;
    if (recipientUid === String(actorUid)) continue;

    const key = `${taskId}|${request.sourceEvent || request.type}|${recipientUid}`;
    if (seenNotificationKeys.has(key)) continue;
    seenNotificationKeys.add(key);

    const eventAt = request.eventAt || now;
    const event = request.sourceEvent || request.type || 'update';
    const notificationId = `task-${taskId}-${event}-${String(eventAt).replace(/[^0-9A-Za-z]/g, '')}-${recipientMemberId}`;
    const notificationRef = doc(db, 'users', recipientUid, 'notifications', notificationId);

    batch.set(notificationRef, {
      id: notificationId,
      recipientUid,
      recipientMemberId,
      type: request.type || 'review',
      priority: request.priority || 'normal',
      title: request.title || 'Task update',
      body: String(request.body || ''),
      taskId,
      commentId: null,
      sourceType: 'taskEvent',
      sourceId: taskId,
      sourceEvent: event,
      actorUid: String(actorUid),
      actorMemberId: request.actorMemberId || null,
      actorName: request.actorName || null,
      read: false,
      at: eventAt,
      createdAt: now,
      updatedAt: now,
      legacy: false
    });
  }

  await batch.commit();
  return tasks;
}

async function deleteTasksBatch(taskIds) {
  const batch = writeBatch(db);

  for (const taskId of taskIds) {
    batch.delete(doc(db, "tasks", String(taskId)));
  }

  await batch.commit();
}

async function updateUserProfile(uid, profileData) {
  const userRef = doc(db, "users", uid);

  await updateDoc(userRef, {
    ...profileData,
    updatedAt: new Date().toISOString()
  });

  return getUserProfile(uid);
}
async function deleteTask(taskId) {
  const taskRef = doc(db, "tasks", String(taskId));

  await deleteDoc(taskRef);
}

window.loginWithGoogle = loginWithGoogle;
window.getUserProfile = getUserProfile;
window.getMember = getMember;
window.subscribeToMembers = subscribeToMembers;
window.saveMember = saveMember;
window.deleteMember = deleteMember;
window.subscribeToProducts = subscribeToProducts;
window.subscribeToActivities = subscribeToActivities;
window.addActivity = addActivity;
window.subscribeToComments = subscribeToComments;
window.getAllComments = getAllComments;
window.addComment = addComment;
window.addCommentWithNotifications = addCommentWithNotifications;
window.subscribeToNotifications = subscribeToNotifications;
window.addNotificationForUser = addNotificationForUser;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.saveProductGroup = saveProductGroup;
window.saveProductGroupAndTasks = saveProductGroupAndTasks;
window.seedProductGroupIfMissing = seedProductGroupIfMissing;
window.createUserProfile = createUserProfile;
window.updateUserProfile = updateUserProfile;
window.addTask = addTask;
window.updateTask = updateTask;
window.updateTasksBatch = updateTasksBatch;
window.deleteTask = deleteTask;
window.deleteTasksBatch = deleteTasksBatch;
window.getTasks = getTasks;
window.subscribeToTasks = subscribeToTasks;

export {
  app,
  auth,
  db,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  loginWithGoogle,
  getUserProfile,
  getMember,
  subscribeToMembers,
  saveMember,
  deleteMember,
  subscribeToProducts,
  subscribeToActivities,
  addActivity,
  subscribeToComments,
  getAllComments,
  addComment,
  addCommentWithNotifications,
  subscribeToNotifications,
  addNotificationForUser,
  markNotificationRead,
  markAllNotificationsRead,
  saveProductGroup,
  saveProductGroupAndTasks,
  seedProductGroupIfMissing,
  createUserProfile,
  getTasks,
  subscribeToTasks,
  addTask,
  updateTask,
  updateTasksBatch,
  deleteTask,
  deleteTasksBatch,
  updateUserProfile
};