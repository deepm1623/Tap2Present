import { auth } from "../../firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { setupStudentPortal } from "./student-portal.js";

const session = await setupStudentPortal();
const button = document.getElementById("resetPassword");
const message = document.getElementById("settingsMessage");

button.addEventListener("click", async () => {
    button.disabled = true;
    try {
        await sendPasswordResetEmail(auth, session.user.email || session.profile.email);
        message.textContent = "A password reset email has been sent.";
        window.showToast(message.textContent, "success", "Reset email sent");
    } catch (error) {
        console.error("Settings password reset error:", error);
        message.textContent = "Unable to send a password reset email.";
        window.showToast(message.textContent, "error", "Reset failed");
    } finally {
        button.disabled = false;
    }
});
