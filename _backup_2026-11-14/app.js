
import { auth, db } from "./firebase-config.js";

import {
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Get HTML elements
const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");

const userRole = document.body.dataset.role;

// Student / Faculty / Admin Login
if (loginForm) {

    loginForm.addEventListener("submit", async function (event) {

        event.preventDefault();

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        message.textContent = "Signing in...";
        message.style.color = "#E99A72";

        try {

            // Step 1: Login with Firebase Authentication
            const userCredential = await signInWithEmailAndPassword(
                auth,
                email,
                password
            );

            const user = userCredential.user;

            // Step 2: Get user profile from Firestore
            const userDocument = await getDoc(
                doc(db, "users", user.uid)
            );

            // Check whether profile exists
            if (!userDocument.exists()) {

                message.textContent = "User profile not found.";
                await signOut(auth);
                return;

            }

            const userData = userDocument.data();

            // Step 3: Check user role
            if (userData.role !== userRole) {

                message.textContent = "You are not allowed to access this portal.";
                await signOut(auth);
                return;

            }

            // Step 4: Check account status
            if (userData.status !== "active") {

                message.textContent = "Your account is waiting for approval.";
                await signOut(auth);
                return;

            }

            // Step 5: Redirect to dashboard
            message.textContent = "Login successful!";

            if (userRole === "student") {

                window.location.href = "student-dashboard.html";

            } else if (userRole === "faculty") {

                window.location.href = "faculty-dashboard.html";

            } else if (userRole === "admin") {

                window.location.href = "admin-dashboard.html";

            }

        } catch (error) {

            console.log("Login error:", error);

            if (
                error.code === "auth/invalid-credential" ||
                error.code === "auth/wrong-password" ||
                error.code === "auth/user-not-found"
            ) {

                message.textContent = "Incorrect email or password.";

            } else if (error.code === "auth/invalid-email") {

                message.textContent = "Please enter a valid email address.";

            } else if (error.code === "permission-denied") {

                message.textContent = "Database permission denied. Check Firestore rules.";

            } else {

                message.textContent = "Something went wrong. Please try again.";

            }

        }

    });

}
