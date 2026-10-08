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

// Stage 11.1 — file metadata groundwork.
// File bytes are intentionally NOT moved anywhere yet; these helpers let the
// app describe files independently from their eventual storage location.
export const FILE_METADATA_SCHEMA_VERSION = 1;

// Stage 11.2 — profile photo handling stays Firestore-only for now.
// We optimize the image in the browser before writing it to Firestore so
// profile documents do not carry the user's original camera-sized file.
export const PROFILE_PHOTO_CONFIG = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024,
  maxOutputBytes: 220 * 1024,
  maxDimension: 512,
  fallbackDimensions: [448, 384, 320],
  qualitySteps: [0.82, 0.74, 0.66, 0.58]
});

function dataUrlByteSize(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return 0;

  const base64 = dataUrl.slice(commaIndex + 1);
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadImageForProcessing(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected image could not be read.'));
    };

    image.src = objectUrl;
  });
}

function canvasDataUrl(canvas, mimeType, quality) {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  // Some browsers ignore unsupported MIME types and silently return PNG.
  const actualMimeType = dataUrl.slice(5, dataUrl.indexOf(';')) || mimeType;
  return {
    dataUrl,
    mimeType: actualMimeType,
    size: dataUrlByteSize(dataUrl)
  };
}

export async function prepareProfilePhoto(file, extra = {}) {
  if (!file) return null;

  const mimeType = String(file.type || '').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error('Profile photo must be an image file.');
  }

  const inputSize = Number(file.size || 0);
  if (inputSize > PROFILE_PHOTO_CONFIG.maxInputBytes) {
    throw new Error('Profile photo is too large. Please choose an image under 10 MB.');
  }

  const image = await loadImageForProcessing(file);
  const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width || 1));
  const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height || 1));
  const sourceMax = Math.max(sourceWidth, sourceHeight);

  const dimensions = [
    PROFILE_PHOTO_CONFIG.maxDimension,
    ...PROFILE_PHOTO_CONFIG.fallbackDimensions
  ];

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    throw new Error('Your browser cannot prepare the profile photo.');
  }

  // Prefer WebP when the browser supports it. JPEG is the fallback.
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  const webpSupported = probeCanvas.toDataURL('image/webp').startsWith('data:image/webp');
  const outputMime = webpSupported ? 'image/webp' : 'image/jpeg';

  for (const maxDimension of dimensions) {
    const scale = Math.min(1, maxDimension / sourceMax);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);

    if (outputMime === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    for (const quality of PROFILE_PHOTO_CONFIG.qualitySteps) {
      const result = canvasDataUrl(canvas, outputMime, quality);
      if (result.size <= PROFILE_PHOTO_CONFIG.maxOutputBytes) {
        const originalName = String(file.name || 'profile-photo');
        const originalBase = originalName.replace(/\.[^.]+$/, '') || 'profile-photo';
        const extension = result.mimeType === 'image/webp' ? 'webp' : 'jpg';

        return {
          dataUrl: result.dataUrl,
          meta: buildFileMetadata(
            {
              name: `${originalBase}.${extension}`,
              type: result.mimeType,
              size: result.size
            },
            {
              ...extra,
              source: 'embedded-data-url',
              storageProvider: null,
              storagePath: null,
              downloadUrl: null,
              width,
              height
            }
          )
        };
      }
    }
  }

  throw new Error('Profile photo could not be compressed below 220 KB. Please choose a simpler image.');
}

export function buildProfilePhotoUrlMetadata(url, extra = {}) {
  if (!url) return null;

  return normalizeFileMetadata({
    ...extra,
    schemaVersion: FILE_METADATA_SCHEMA_VERSION,
    name: extra.name || 'Google profile photo',
    mimeType: extra.mimeType || 'image/*',
    size: Number(extra.size || 0),
    source: 'auth-photo-url',
    storageProvider: null,
    storagePath: null,
    downloadUrl: url,
    uploadedByUid: extra.uploadedByUid || auth.currentUser?.uid || null,
    uploadedAt: extra.uploadedAt || null
  });
}

export function buildFileMetadata(file, extra = {}) {
  if (!file) return null;

  return {
    schemaVersion: FILE_METADATA_SCHEMA_VERSION,
    id: extra.id || null,
    name: String(file.name || extra.name || 'Unnamed file'),
    mimeType: String(file.type || extra.mimeType || 'application/octet-stream'),
    size: Number(file.size || extra.size || 0),
    source: extra.source || 'local-selection',
    storageProvider: extra.storageProvider || null,
    storagePath: extra.storagePath || null,
    downloadUrl: extra.downloadUrl || null,
    uploadedByUid: extra.uploadedByUid || auth.currentUser?.uid || null,
    uploadedAt: extra.uploadedAt || new Date().toISOString(),
    width: Number.isFinite(Number(extra.width)) ? Number(extra.width) : null,
    height: Number.isFinite(Number(extra.height)) ? Number(extra.height) : null
  };
}

export function normalizeFileMetadata(meta, fallback = {}) {
  const source = meta || {};
  const dataUrl = fallback.data || source.data || '';
  const isEmbeddedLegacy = !source.source && Boolean(dataUrl);

  return {
    schemaVersion: Number(source.schemaVersion || FILE_METADATA_SCHEMA_VERSION),
    id: source.id || fallback.id || null,
    name: String(source.name || fallback.name || 'Unnamed file'),
    mimeType: String(source.mimeType || source.type || fallback.mimeType || fallback.type || 'application/octet-stream'),
    size: Number(source.size || fallback.size || 0),
    source: source.source || (isEmbeddedLegacy ? 'legacy-data-url' : 'unknown'),
    storageProvider: source.storageProvider || null,
    storagePath: source.storagePath || null,
    downloadUrl: source.downloadUrl || source.url || null,
    uploadedByUid: source.uploadedByUid || fallback.uploadedByUid || null,
    uploadedAt: source.uploadedAt || fallback.uploadedAt || null,
    resourceType: source.resourceType || fallback.resourceType || null,
    resourceId: source.resourceId || fallback.resourceId || null,
    accessScope: source.accessScope || fallback.accessScope || null,
    manageScope: source.manageScope || fallback.manageScope || null,
    width: source.width == null ? null : Number(source.width),
    height: source.height == null ? null : Number(source.height),
    originalSize: source.originalSize == null
      ? (fallback.originalSize == null ? null : Number(fallback.originalSize))
      : Number(source.originalSize)
  };
}

// Stage 11.3 — task attachment handling stays Firestore-embedded for now.
// The browser normalizes small attachments and keeps an explicit metadata
// record so a future storage backend can replace the `data` field cleanly.
export const TASK_ATTACHMENT_ACCESS = Object.freeze({
  readScope: 'task-readers',
  manageScope: 'task-editors',
  resourceType: 'task'
});

export function buildTaskAttachmentMetadata(meta, taskId) {
  const normalized = normalizeFileMetadata(meta);
  return {
    ...normalized,
    resourceType: TASK_ATTACHMENT_ACCESS.resourceType,
    resourceId: taskId != null ? String(taskId) : null,
    accessScope: TASK_ATTACHMENT_ACCESS.readScope,
    manageScope: TASK_ATTACHMENT_ACCESS.manageScope
  };
}

export function isTaskAttachmentReadable(metadata, taskId) {
  const normalized = buildTaskAttachmentMetadata(metadata, taskId);
  return normalized.resourceType === TASK_ATTACHMENT_ACCESS.resourceType
    && (!normalized.resourceId || String(normalized.resourceId) === String(taskId));
}

export const TASK_ATTACHMENT_CONFIG = Object.freeze({
  maxInputBytes: 5 * 1024 * 1024,
  maxEmbeddedFileBytes: 300 * 1024,
  maxEmbeddedTotalBytes: 520 * 1024,
  maxImageDimension: 1600,
  maxImageBytes: 260 * 1024,
  imageQualitySteps: [0.82, 0.74, 0.66, 0.58],
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv'
  ]
});

function createAttachmentId() {
  const suffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `att-${suffix}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'the selected file'}.`));
    reader.readAsDataURL(file);
  });
}

function loadAttachmentImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not process ${file?.name || 'the selected image'}.`));
    };

    image.src = objectUrl;
  });
}

function prepareEmbeddedImageAttachment(file) {
  return loadAttachmentImage(file).then(image => {
    const sourceWidth = Math.max(1, Number(image.naturalWidth || image.width || 1));
    const sourceHeight = Math.max(1, Number(image.naturalHeight || image.height || 1));
    const sourceMax = Math.max(sourceWidth, sourceHeight);
    const maxDimension = TASK_ATTACHMENT_CONFIG.maxImageDimension;
    const scale = Math.min(1, maxDimension / sourceMax);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot prepare this image attachment.');

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const webpSupported = probe.toDataURL('image/webp').startsWith('data:image/webp');
    const outputMime = webpSupported ? 'image/webp' : 'image/jpeg';

    for (const quality of TASK_ATTACHMENT_CONFIG.imageQualitySteps) {
      const dataUrl = canvas.toDataURL(outputMime, quality);
      const size = dataUrlByteSize(dataUrl);
      if (size <= TASK_ATTACHMENT_CONFIG.maxImageBytes) {
        return {
          dataUrl,
          size,
          mimeType: outputMime,
          width,
          height
        };
      }
    }

    throw new Error(`Image attachment "${file.name}" is too detailed to fit the current task file budget.`);
  });
}

export async function prepareTaskAttachments(files = [], existingAttachments = []) {
  const selectedFiles = Array.isArray(files) ? files : [];
  const existing = Array.isArray(existingAttachments) ? existingAttachments : [];

  const existingBytes = existing.reduce((total, attachment) => {
    return total + dataUrlByteSize(attachment?.data || '');
  }, 0);

  const prepared = [];
  let runningBytes = existingBytes;

  for (const file of selectedFiles) {
    if (!file) continue;

    const mimeType = String(file.type || 'application/octet-stream').toLowerCase();
    const inputSize = Number(file.size || 0);
    if (inputSize > TASK_ATTACHMENT_CONFIG.maxInputBytes) {
      throw new Error(`"${file.name}" is larger than 5 MB.`);
    }

    const isImage = mimeType.startsWith('image/');
    const isAllowedDocument = TASK_ATTACHMENT_CONFIG.allowedMimeTypes.includes(mimeType);
    if (!isImage && !isAllowedDocument) {
      throw new Error(`"${file.name}" is not a supported attachment type.`);
    }

    let dataUrl;
    let finalSize;
    let finalMime = mimeType;
    let width = null;
    let height = null;

    if (isImage && ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      const imageResult = await prepareEmbeddedImageAttachment(file);
      dataUrl = imageResult.dataUrl;
      finalSize = imageResult.size;
      finalMime = imageResult.mimeType;
      width = imageResult.width;
      height = imageResult.height;
    } else {
      if (inputSize > TASK_ATTACHMENT_CONFIG.maxEmbeddedFileBytes) {
        throw new Error(`"${file.name}" is larger than 300 KB. Please use a smaller file for this Firestore-only version.`);
      }
      dataUrl = await readFileAsDataUrl(file);
      finalSize = dataUrlByteSize(dataUrl);
      if (finalSize > TASK_ATTACHMENT_CONFIG.maxEmbeddedFileBytes) {
        throw new Error(`"${file.name}" is larger than the current embedded attachment limit.`);
      }
    }

    if ((runningBytes + finalSize) > TASK_ATTACHMENT_CONFIG.maxEmbeddedTotalBytes) {
      throw new Error(`Task attachments exceed the temporary ${Math.round(TASK_ATTACHMENT_CONFIG.maxEmbeddedTotalBytes / 1024)} KB workspace file budget.`);
    }

    const id = createAttachmentId();
    const meta = buildTaskAttachmentMetadata(
      buildFileMetadata(
        { name: file.name, type: finalMime, size: finalSize },
        {
          id,
          source: 'embedded-data-url',
          storageProvider: null,
          storagePath: null,
          downloadUrl: null,
          uploadedByUid: auth.currentUser?.uid || null,
          originalSize: inputSize,
          width,
          height
        }
      ),
      null
    );
    meta.originalSize = inputSize;

    prepared.push({
      attachment: {
        id,
        name: String(file.name || 'attachment'),
        size: finalSize,
        type: finalMime,
        data: dataUrl
      },
      metadata: meta
    });

    runningBytes += finalSize;
  }

  return prepared;
}

export function attachmentDataUrlSize(dataUrl) {
  return dataUrlByteSize(dataUrl);
}

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


function subscribeToDepartments(onChange, onError) {
  const departmentsRef = collection(db, "departments");

  return onSnapshot(
    departmentsRef,
    snapshot => {
      const departments = snapshot.docs
        .map(docSnap => ({
          ...docSnap.data(),
          id: String(docSnap.id)
        }))
        .filter(department => department.id && department.id !== 'all');

      onChange(departments, snapshot);
    },
    error => {
      console.error("Realtime departments listener gagal:", error);
      if (typeof onError === "function") onError(error);
    }
  );
}

async function saveDepartment(department) {
  const departmentId = String(department?.id || '').trim();
  if (!departmentId || departmentId === 'all') {
    throw new Error("Department ID tidak valid.");
  }

  const departmentRef = doc(db, "departments", departmentId);
  await setDoc(departmentRef, {
    ...department,
    id: departmentId,
    name: String(department?.name || 'Unnamed Department').trim() || 'Unnamed Department',
    color: department?.color || '#0F766E',
    updatedAt: new Date().toISOString()
  }, { merge: true });

  const snapshot = await getDoc(departmentRef);
  return snapshot.exists() ? { ...snapshot.data(), id: String(snapshot.id) } : null;
}

async function deleteDepartment(departmentId) {
  const id = String(departmentId || '').trim();
  if (!id || id === 'all') throw new Error("Department ID tidak valid.");
  await deleteDoc(doc(db, "departments", id));
}

async function seedDefaultDepartmentsIfMissing(departments) {
  if (!Array.isArray(departments)) return;

  for (const department of departments) {
    if (!department?.id || department.id === 'all') continue;

    const departmentRef = doc(db, "departments", String(department.id));

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(departmentRef);
      if (snapshot.exists()) return;

      transaction.set(departmentRef, {
        id: String(department.id),
        name: String(department.name || 'Unnamed Department').trim() || 'Unnamed Department',
        color: department.color || '#0F766E',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
  }
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

async function deleteProductGroup(divisionId) {
  const id = String(divisionId || '').trim();
  if (!id) throw new Error("Division ID product tidak boleh kosong.");
  await deleteDoc(doc(db, "products", id));
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
  const createdByUid = task.createdByUid || actorUid;

  // Keep identity fields on the in-memory task as well as Firestore.
  task.createdByUid = createdByUid;
  task.updatedByUid = actorUid;
  task.updatedAt = task.updatedAt || now;

  // STEP 1: create the task by itself.
  // A notification permission problem must never roll back the new task.
  await setDoc(taskRef, { ...task });

  console.log("✅ Task berhasil disimpan ke Firestore:", task);

  // STEP 2: assignment notification for a newly-created task.
  // This is intentionally a separate write so the notification Rules can
  // validate the already-persisted task with get().
  const requests = Array.isArray(notificationRequests)
    ? notificationRequests.filter(
        r => r && r.sourceType === 'taskEvent' && r.type === 'assigned'
      )
    : [];

  if (!requests.length || !actorUid) return task;

  try {
    const batch = writeBatch(db);
    const seen = new Set();

    for (const request of requests) {
      const recipientUid = String(request.recipientUid || '').trim();
      const recipientMemberId = String(request.recipientMemberId || '').trim();
      if (!recipientUid || !recipientMemberId) continue;
      if (recipientUid === String(actorUid)) continue;

      const eventAt = request.eventAt || task.updatedAt || now;
      const key = `${recipientUid}|assigned_created|${recipientMemberId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const notificationId = `task-${taskId}-assigned-${String(eventAt).replace(/[^0-9A-Za-z]/g, '')}-${recipientMemberId}`;
      const notificationRef = doc(
        db,
        'users',
        recipientUid,
        'notifications',
        notificationId
      );

      batch.set(notificationRef, {
        id: notificationId,
        recipientUid,
        recipientMemberId,
        type: 'assigned',
        priority: request.priority || 'normal',
        title: request.title || 'Task assigned to you',
        body: String(request.body || ''),
        taskId,
        commentId: null,
        sourceType: 'taskEvent',
        sourceId: taskId,
        sourceEvent: 'assigned_created',
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

    if (seen.size) {
      await batch.commit();
      console.log('🔔 New-task assignment notification(s) created:', seen.size);
    }
  } catch (notificationError) {
    // Keep task creation successful even if the optional notification write
    // is blocked or temporarily fails.
    console.error(
      '⚠️ Task created, but assignment notification failed:',
      notificationError
    );
  }

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


async function getAllWorkspaceCollectionDocs(collectionName) {
  const snapshot = await getDocs(collection(db, collectionName));
  return snapshot.docs.map(docSnap => ({
    ...docSnap.data(),
    id: String(docSnap.id)
  }));
}

async function commitBatchOperations(operations, chunkSize = 400) {
  for (let start = 0; start < operations.length; start += chunkSize) {
    const chunk = operations.slice(start, start + chunkSize);
    const batch = writeBatch(db);

    for (const operation of chunk) {
      if (operation.type === 'delete') {
        batch.delete(operation.ref);
      } else if (operation.type === 'set') {
        batch.set(operation.ref, operation.data, operation.options || {});
      } else if (operation.type === 'update') {
        batch.update(operation.ref, operation.data);
      }
    }

    await batch.commit();
  }
}

function normalizeImportedTask(task, actorUid) {
  const now = new Date().toISOString();
  const createdAt = task?.createdAt || now;

  return {
    ...task,
    id: String(task?.id || ''),
    product: task?.product || '',
    createdBy: task?.createdBy || 'admin',
    createdByUid: task?.createdByUid || actorUid,
    updatedByUid: task?.updatedByUid || actorUid,
    createdAt,
    updatedAt: task?.updatedAt || createdAt,
    status: task?.status || 'todo',
    statusHistory: Array.isArray(task?.statusHistory) && task.statusHistory.length
      ? task.statusHistory
      : [{ status: task?.status || 'todo', at: createdAt, by: task?.createdBy || 'admin' }],
    contributors: Array.isArray(task?.contributors) ? task.contributors : [],
    attachments: Array.isArray(task?.attachments) ? task.attachments : [],
    archived: task?.archived === true
  };
}

async function replaceWorkspaceData(payload, actorUid) {
  if (!actorUid || auth.currentUser?.uid !== actorUid) {
    throw new Error('Active Firebase session is required for workspace import.');
  }

  const userProfile = await getUserProfile(actorUid);
  if (userProfile?.accessLevel !== 'all') {
    throw new Error('Only all-access users can import workspace data.');
  }

  const normalizedTasks = (Array.isArray(payload?.tasks) ? payload.tasks : [])
    .map(task => normalizeImportedTask(task, actorUid))
    .filter(task => task.id);

  const normalizedMembers = (Array.isArray(payload?.members) ? payload.members : [])
    .map(member => ({
      ...member,
      id: String(member?.id || '').trim(),
      name: member?.name || 'Unnamed Member',
      email: member?.email || '',
      role: member?.role || 'member',
      active: member?.active !== false
    }))
    .filter(member => member.id);

  const normalizedDepartments = Array.isArray(payload?.departments)
    ? payload.departments
        .map(department => ({
          ...department,
          id: String(department?.id || '').trim(),
          name: String(department?.name || 'Unnamed Department').trim() || 'Unnamed Department',
          color: department?.color || '#0F766E'
        }))
        .filter(department => department.id && department.id !== 'all')
    : null;

  const normalizedProducts = {};
  if (payload?.products && typeof payload.products === 'object') {
    for (const [divisionId, items] of Object.entries(payload.products)) {
      normalizedProducts[String(divisionId)] = Array.isArray(items)
        ? items.map(item => String(item).trim()).filter(Boolean)
        : [];
    }
  }

  const normalizedActivities = (Array.isArray(payload?.activities) ? payload.activities : [])
    .map(activity => ({
      ...activity,
      id: String(activity?.id || `imported-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      actorUid: activity?.actorUid || null,
      actorId: activity?.actorId || activity?.actorUid || 'unknown',
      actorName: activity?.actorName || 'Unknown',
      action: activity?.action || 'update',
      detail: activity?.detail || '',
      at: activity?.at || activity?.createdAt || new Date().toISOString(),
      legacy: true,
      migratedFromBackup: true,
      migratedByUid: actorUid
    }));

  const normalizedComments = (Array.isArray(payload?.comments) ? payload.comments : [])
    .map(comment => ({
      ...comment,
      id: String(comment?.id || `imported-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      taskId: String(comment?.taskId || ''),
      authorId: String(comment?.authorId || 'unknown'),
      authorName: comment?.authorName || 'Unknown',
      authorUid: comment?.authorUid || null,
      text: String(comment?.text || '').trim(),
      at: comment?.at || comment?.createdAt || new Date().toISOString(),
      createdAt: comment?.createdAt || comment?.at || new Date().toISOString(),
      replyToId: comment?.replyToId ? String(comment.replyToId) : null,
      mentions: Array.isArray(comment?.mentions) ? comment.mentions.map(String) : [],
      legacy: true,
      migratedFromBackup: true,
      migratedByUid: actorUid
    }))
    .filter(comment => comment.taskId && comment.text);

  const normalizedNotifications = (Array.isArray(payload?.notifications) ? payload.notifications : [])
    .map(notification => ({
      ...notification,
      id: String(notification?.id || `imported-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      recipientUid: actorUid,
      recipientMemberId: notification?.recipientMemberId || null,
      type: notification?.type || 'message',
      priority: notification?.priority || 'normal',
      title: notification?.title || 'Imported notification',
      body: String(notification?.body || ''),
      taskId: notification?.taskId == null ? null : String(notification.taskId),
      commentId: notification?.commentId == null ? null : String(notification.commentId),
      sourceType: 'legacy',
      sourceId: notification?.sourceId == null ? null : String(notification.sourceId),
      sourceEvent: notification?.sourceEvent || 'imported',
      actorUid: notification?.actorUid || null,
      actorMemberId: notification?.actorMemberId || null,
      actorName: notification?.actorName || null,
      read: notification?.read === true,
      at: notification?.at || notification?.createdAt || new Date().toISOString(),
      createdAt: notification?.createdAt || notification?.at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      legacy: true,
      migratedByUid: actorUid
    }));

  const [existingTasks, existingMembers, existingDepartments, existingProducts, existingActivities, existingComments, notificationSnapshot] = await Promise.all([
    getAllWorkspaceCollectionDocs('tasks'),
    getAllWorkspaceCollectionDocs('members'),
    getAllWorkspaceCollectionDocs('departments'),
    getAllWorkspaceCollectionDocs('products'),
    getAllWorkspaceCollectionDocs('activities'),
    getAllWorkspaceCollectionDocs('comments'),
    getDocs(collection(db, 'users', actorUid, 'notifications'))
  ]);

  const deleteOperations = [];
  for (const item of existingTasks) deleteOperations.push({ type: 'delete', ref: doc(db, 'tasks', item.id) });
  for (const item of existingMembers) deleteOperations.push({ type: 'delete', ref: doc(db, 'members', item.id) });
  if (normalizedDepartments) {
    for (const item of existingDepartments) deleteOperations.push({ type: 'delete', ref: doc(db, 'departments', item.id) });
  }
  for (const item of existingProducts) deleteOperations.push({ type: 'delete', ref: doc(db, 'products', item.id) });
  for (const item of existingActivities) deleteOperations.push({ type: 'delete', ref: doc(db, 'activities', item.id) });
  for (const item of existingComments) deleteOperations.push({ type: 'delete', ref: doc(db, 'comments', item.id) });
  for (const docSnap of notificationSnapshot.docs) {
    deleteOperations.push({
      type: 'delete',
      ref: doc(db, 'users', actorUid, 'notifications', docSnap.id)
    });
  }

  await commitBatchOperations(deleteOperations);

  const writeOperations = [];
  for (const task of normalizedTasks) writeOperations.push({ type: 'set', ref: doc(db, 'tasks', task.id), data: task });
  for (const member of normalizedMembers) writeOperations.push({ type: 'set', ref: doc(db, 'members', member.id), data: member });
  if (normalizedDepartments) {
    for (const department of normalizedDepartments) writeOperations.push({ type: 'set', ref: doc(db, 'departments', department.id), data: department });
  }
  for (const [divisionId, items] of Object.entries(normalizedProducts)) {
    writeOperations.push({
      type: 'set',
      ref: doc(db, 'products', divisionId),
      data: { divisionId, items, updatedAt: new Date().toISOString() },
      options: { merge: true }
    });
  }
  for (const activity of normalizedActivities) {
    const id = String(activity.id);
    writeOperations.push({ type: 'set', ref: doc(db, 'activities', id), data: { ...activity, id } });
  }
  for (const comment of normalizedComments) {
    const id = String(comment.id);
    writeOperations.push({ type: 'set', ref: doc(db, 'comments', id), data: { ...comment, id } });
  }
  for (const notification of normalizedNotifications) {
    const id = String(notification.id);
    writeOperations.push({ type: 'set', ref: doc(db, 'users', actorUid, 'notifications', id), data: { ...notification, id } });
  }

  const maxTaskNumber = normalizedTasks.reduce((max, task) => {
    const match = String(task.id).match(/^task-(\d+)$/i);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  writeOperations.push({
    type: 'set',
    ref: doc(db, 'counters', 'tasks'),
    data: {
      lastNumber: maxTaskNumber,
      updatedAt: new Date().toISOString(),
      importSource: 'workspaceImport',
      importedByUid: actorUid
    },
    options: { merge: true }
  });

  await commitBatchOperations(writeOperations);

  return {
    tasks: normalizedTasks,
    members: normalizedMembers,
    departments: normalizedDepartments,
    products: normalizedProducts,
    activities: normalizedActivities,
    comments: normalizedComments,
    notifications: normalizedNotifications
  };
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
window.FILE_METADATA_SCHEMA_VERSION = FILE_METADATA_SCHEMA_VERSION;
window.buildFileMetadata = buildFileMetadata;
window.normalizeFileMetadata = normalizeFileMetadata;
window.PROFILE_PHOTO_CONFIG = PROFILE_PHOTO_CONFIG;
window.TASK_ATTACHMENT_CONFIG = TASK_ATTACHMENT_CONFIG;
window.prepareProfilePhoto = prepareProfilePhoto;
window.prepareTaskAttachments = prepareTaskAttachments;
window.attachmentDataUrlSize = attachmentDataUrlSize;
window.buildProfilePhotoUrlMetadata = buildProfilePhotoUrlMetadata;
window.getUserProfile = getUserProfile;
window.getMember = getMember;
window.subscribeToMembers = subscribeToMembers;
window.subscribeToDepartments = subscribeToDepartments;
window.saveDepartment = saveDepartment;
window.deleteDepartment = deleteDepartment;
window.seedDefaultDepartmentsIfMissing = seedDefaultDepartmentsIfMissing;
window.saveMember = saveMember;
window.deleteMember = deleteMember;
window.subscribeToProducts = subscribeToProducts;
window.subscribeToActivities = subscribeToActivities;
window.addActivity = addActivity;
window.subscribeToComments = subscribeToComments;
window.getAllComments = getAllComments;
window.replaceWorkspaceData = replaceWorkspaceData;
window.addComment = addComment;
window.addCommentWithNotifications = addCommentWithNotifications;
window.subscribeToNotifications = subscribeToNotifications;
window.addNotificationForUser = addNotificationForUser;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.saveProductGroup = saveProductGroup;
window.saveProductGroupAndTasks = saveProductGroupAndTasks;
window.deleteProductGroup = deleteProductGroup;
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
  FILE_METADATA_SCHEMA_VERSION,
  buildFileMetadata,
  normalizeFileMetadata,
  PROFILE_PHOTO_CONFIG,
  TASK_ATTACHMENT_CONFIG,
  prepareProfilePhoto,
  prepareTaskAttachments,
  attachmentDataUrlSize,
  buildProfilePhotoUrlMetadata,
  getUserProfile,
  getMember,
  subscribeToMembers,
  subscribeToDepartments,
  saveDepartment,
  deleteDepartment,
  seedDefaultDepartmentsIfMissing,
  saveMember,
  deleteMember,
  subscribeToProducts,
  subscribeToActivities,
  addActivity,
  subscribeToComments,
  getAllComments,
  replaceWorkspaceData,
  addComment,
  addCommentWithNotifications,
  subscribeToNotifications,
  addNotificationForUser,
  markNotificationRead,
  markAllNotificationsRead,
  saveProductGroup,
  saveProductGroupAndTasks,
  deleteProductGroup,
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