import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, off } from "firebase/database";

// Firebase config for the Rakhwaal test project.
// NOTE: this apiKey is a public client identifier, not a secret — Firebase
// security relies on the Realtime Database "Rules", not on hiding this key.
const firebaseConfig = {
  apiKey: "AIzaSyDLn90PGEzz5V8CA65JTe6lpY27YoVpumo",
  authDomain: "rakhwaal.firebaseapp.com",
  databaseURL: "https://rakhwaal-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rakhwaal",
  storageBucket: "rakhwaal.firebasestorage.app",
  messagingSenderId: "129085375795",
  appId: "1:129085375795:web:f588dcc7e2ff1b583baa46",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Single shared "live" channel for this family test group.
// In a production version this would be scoped per-family with auth.
const LIVE_PATH = "live/alert";

export function pushLiveAlert(data) {
  return set(ref(db, LIVE_PATH), data).catch((err) => {
    console.error("Firebase write failed:", err);
  });
}

export function clearLiveAlert() {
  return set(ref(db, LIVE_PATH), {
    status: "safe",
    updatedAt: Date.now(),
  }).catch((err) => {
    console.error("Firebase clear failed:", err);
  });
}

export function subscribeLiveAlert(callback) {
  const liveRef = ref(db, LIVE_PATH);
  onValue(
    liveRef,
    (snapshot) => {
      callback(snapshot.val());
    },
    (err) => {
      console.error("Firebase read failed:", err);
      callback(null);
    }
  );
  return () => off(liveRef);
}
