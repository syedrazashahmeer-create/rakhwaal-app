import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, off } from "firebase/database";

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
// overwriting each other.
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

// ---------------- Profiles (lightweight, test-only accounts) ----------------
// NOTE: this is a simple test-grade gate, not real production security —
// the password hash is readable by anyone who reads the database directly.
// It's enough to stop someone from accidentally picking a family member's
// name and seeing their private contacts, not a substitute for real auth.
const PROFILES_PATH = "profiles";

export function subscribeProfileList(callback) {
  const profilesRef = ref(db, PROFILES_PATH);
  onValue(
    profilesRef,
    (snapshot) => {
      callback(snapshot.val() || {});
    },
    (err) => {
      console.error("Firebase profile list read failed:", err);
      callback({});
    }
  );
  return () => off(profilesRef);
}

export async function getProfile(profileId) {
  try {
    const snap = await get(ref(db, `${PROFILES_PATH}/${profileId}`));
    return snap.val();
  } catch (err) {
    console.error("Firebase profile read failed:", err);
    return null;
  }
}

export async function createProfile(profileId, profileData) {
  return set(ref(db, `${PROFILES_PATH}/${profileId}`), profileData);
}

export async function saveProfileContacts(profileId, contactsObj) {
  return set(ref(db, `${PROFILES_PATH}/${profileId}/contacts`), contactsObj);
}

// ---------------- Admin gate ----------------
// A single shared admin password (separate from individual profile
// passwords) protects the admin panel. First person to open it sets it.
const ADMIN_PATH = "admin/passwordHash";

export async function getAdminPasswordHash() {
  try {
    const snap = await get(ref(db, ADMIN_PATH));
    return snap.val();
  } catch (err) {
    console.error("Firebase admin read failed:", err);
    return null;
  }
}

export async function setAdminPasswordHash(hash) {
  return set(ref(db, ADMIN_PATH), hash);
}

