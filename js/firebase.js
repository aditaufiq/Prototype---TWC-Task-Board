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
  writeBatch
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

async function addTask(task) {
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

  // Ganti ID timestamp menjadi ID urut
  task.id = taskId;

  const taskRef = doc(db, "tasks", taskId);

  await setDoc(taskRef, {
    ...task,
    updatedAt: new Date().toISOString()
  });

  console.log("✅ Task berhasil disimpan ke Firestore:", task);

  return task;
}

async function updateTask(taskId, taskData) {
  const taskRef = doc(db, "tasks", String(taskId));

  await updateDoc(taskRef, {
    ...taskData,
    updatedAt: new Date().toISOString()
  });

  return taskData;
}

async function updateTasksBatch(tasks) {
  const batch = writeBatch(db);
  const now = new Date().toISOString();

  for (const task of tasks) {
    const taskRef = doc(db, "tasks", String(task.id));
    batch.update(taskRef, {
      ...task,
      updatedAt: task.updatedAt || now
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