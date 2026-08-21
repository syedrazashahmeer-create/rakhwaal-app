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

// Each family member gets their own node under live/users/{userId}, so
// several people can have an active alert at the same time without
// overwriting each other. No auth — userId is a locally-chosen identity.
const USERS_PATH = "live/users";

export function pushUserLiveAlert(userId, data) {
  return set(ref(db, `${USERS_PATH}/${userId}`), data).catch((err) => {
    console.error("Firebase write failed:", err);
  });
}

export function clearUserLiveAlert(userId, name) {
  return set(ref(db, `${USERS_PATH}/${userId}`), {
    name,
    status: "safe",
    updatedAt: Date.now(),
  }).catch((err) => {
    console.error("Firebase clear failed:", err);
  });
}

export function subscribeAllUsers(callback) {
  const usersRef = ref(db, USERS_PATH);
  onValue(
    usersRef,
    (snapshot) => {
      callback(snapshot.val() || {});
    },
    (err) => {
      console.error("Firebase read failed:", err);
      callback({});
    }
  );
  return () => off(usersRef);
}

