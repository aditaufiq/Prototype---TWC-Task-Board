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
  runTransaction
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
window.createUserProfile = createUserProfile;
window.updateUserProfile = updateUserProfile;
window.addTask = addTask;
window.updateTask = updateTask;
window.deleteTask = deleteTask;
window.getTasks = getTasks;

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
  createUserProfile,
  getTasks,
  addTask,
  updateTask,
  deleteTask,
  updateUserProfile
};