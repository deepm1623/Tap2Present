
import { initializeApp } from
    "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import { getAuth } from
    "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import { getFirestore } from
    "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Firebase project configuration
const firebaseConfig = {
    apiKey: "AIzaSyDbqXavPbDRMSiRW5s4Bg1EY3HIcuZqlQU",
    authDomain: "ap2present.firebaseapp.com",
    projectId: "tap2present",
    storageBucket: "tap2present.firebasestorage.app",
    messagingSenderId: "188873941666",
    appId: "1:188873941666:web:fcca8457d3c91791152dfb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
const auth = getAuth(app);

// Initialize Firestore
const db = getFirestore(app);

// Export Firebase services
export { app, auth, db };
