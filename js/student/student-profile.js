import { setupStudentPortal } from "./student-portal.js";
import { auth, db } from "../../firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { updateDoc, doc } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await setupStudentPortal();
const profile = session.profile;
const profileForm = document.getElementById("profileForm");
const phoneInput = document.getElementById("phone");
const profileMessage = document.getElementById("profileMessage");

if (!profile.className) {
    profile.className = profile.classId || profile.class || profile.department || "";
}

document.querySelectorAll("[data-profile-field]").forEach(element => {
    const field = element.dataset.profileField;
    const value = profile[field];
    element.textContent = value === undefined || value === null || value === ""
        ? "Not provided"
        : String(value);
});

phoneInput.value = profile.phone || "";

profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const phone = phoneInput.value.trim();

    if (phone && !/^[0-9+()\-\s]{7,30}$/.test(phone)) {
        profileMessage.textContent = "Enter a valid phone number.";
        return;
    }

    try {
        await updateDoc(doc(db, "users", session.user.uid), { phone });
        profileMessage.textContent = "Phone number updated.";
        document.querySelector('[data-profile-field="phone"]').textContent = phone || "Not provided";
        window.showToast("Your phone number was updated.", "success", "Profile updated");
    } catch (error) {
        console.error("Profile update error:", error);
        profileMessage.textContent = error.code === "permission-denied"
            ? "Your account permissions do not allow this update."
            : "Unable to update your phone number.";
        window.showToast(profileMessage.textContent, "error", "Update failed");
    }
});

document.getElementById("resetPassword").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
        await sendPasswordResetEmail(auth, session.user.email || profile.email);
        window.showToast("A password reset email has been sent.", "success", "Reset email sent");
    } catch (error) {
        console.error("Password reset error:", error);
        window.showToast("Unable to send a password reset email.", "error", "Reset failed");
    } finally {
        button.disabled = false;
    }
});
