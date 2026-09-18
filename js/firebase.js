import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

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
const provider = new GoogleAuthProvider();

export {
  app,
  auth,
  provider,
  signInWithPopup,
  signOut
};