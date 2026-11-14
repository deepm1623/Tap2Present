import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const role = document.body.dataset.role;
const form = document.getElementById("loginForm");
const message = document.getElementById("message");

function showMessage(text, color) {
    if (message) {
        message.textContent = text;
        message.style.color = color || "";
    }
}

if (form && role) {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        showMessage("Signing in...", "#E99A72");
        try {
            const credentials = await signInWithEmailAndPassword(auth, document.getElementById("email").value.trim(), document.getElementById("password").value);
            const profileSnapshot = await getDoc(doc(db, "users", credentials.user.uid));
            if (!profileSnapshot.exists()) throw new Error("profile-not-found");
            const profile = profileSnapshot.data();
            if (profile.role !== role) throw new Error("wrong-role");
            if (profile.status !== "active") throw new Error("inactive-account");
            window.location.href = `../${role}/${role}-dashboard.html`;
        } catch (error) {
            if (error.message === "profile-not-found") showMessage("User profile not found.");
            else if (error.message === "wrong-role") showMessage("You are not allowed to access this portal.");
            else if (error.message === "inactive-account") showMessage("Your account is waiting for approval.");
            else if (error.code === "auth/invalid-email") showMessage("Please enter a valid email address.");
            else if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password" || error.code === "auth/user-not-found") showMessage("Incorrect email or password.");
            else showMessage("Something went wrong. Please try again.");
            await signOut(auth).catch(() => {});
        }
    });
}

export async function requireRole(expectedRole) {
    return new Promise((resolve) => {
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                window.location.href = `../${expectedRole}/${expectedRole}-login.html`;
                return;
            }
            const snapshot = await getDoc(doc(db, "users", user.uid));
            const profile = snapshot.exists() ? snapshot.data() : null;
            if (!profile || profile.role !== expectedRole || profile.status !== "active") {
                await signOut(auth);
                window.location.href = `../${expectedRole}/${expectedRole}-login.html`;
                return;
            }
            resolve({ user, profile });
        });
    });
}

export async function logout() {
    await signOut(auth);
    window.location.href = "../index.html";
}
