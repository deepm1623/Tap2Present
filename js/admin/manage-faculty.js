import { requireRole, logout } from "../auth.js";
import { db } from "../../firebase-config.js";
import {
    createUserWithEmailAndPassword,
    getAuth,
    sendPasswordResetEmail,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await requireRole("admin");
document.querySelector("[data-logout]").addEventListener("click", async (event) => {
    event.preventDefault();
    await logout();
});

const defaultApp = getApp();
let secondaryApp = getApps().find(app => app.name === "FacultyAccountCreator");
if (!secondaryApp) {
    secondaryApp = initializeApp(defaultApp.options, "FacultyAccountCreator");
}
const facultyAuth = getAuth(secondaryApp);

const facultyMessage = document.getElementById("facultyMessage");
const facultyForm = document.getElementById("facultyForm");
const facultyTableBody = document.getElementById("facultyTableBody");
const saveFacultyButton = document.getElementById("saveFacultyButton");

let facultyAccounts = [];

await loadFaculty();

facultyForm.addEventListener("submit", async event => {
    event.preventDefault();
    saveFacultyButton.disabled = true;

    const name = document.getElementById("facultyName").value.trim();
    const email = document.getElementById("facultyEmail").value.trim().toLowerCase();
    const password = document.getElementById("facultyPassword").value;
    const department = document.getElementById("facultyDepartment").value.trim();

    try {
        const credential = await createUserWithEmailAndPassword(facultyAuth, email, password);
        await setDoc(doc(db, "users", credential.user.uid), {
            name,
            email,
            role: "faculty",
            status: "active",
            department,
            createdBy: session.user.uid,
            createdAt: serverTimestamp()
        });
        facultyMessage.textContent = `${name} was added to the faculty directory.`;
        facultyForm.reset();
        await loadFaculty();
    } catch (error) {
        console.error("Create faculty error:", error);
        facultyMessage.textContent = error.code === "permission-denied"
            ? "Firestore permission error. Faculty profiles can only be created by an active admin."
            : error.message || "Unable to create this faculty account.";
    } finally {
        if (facultyAuth.currentUser) {
            await signOut(facultyAuth).catch(() => {});
        }
        saveFacultyButton.disabled = false;
    }
});

facultyTableBody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const uid = button.dataset.uid;
    const faculty = facultyAccounts.find(account => account.uid === uid);
    if (!faculty) return;

    button.disabled = true;

    try {
        if (button.dataset.action === "toggle") {
            const nextStatus = faculty.status === "active" ? "inactive" : "active";
            await updateDoc(doc(db, "users", uid), {
                status: nextStatus,
                updatedAt: serverTimestamp()
            });
            facultyMessage.textContent = `${faculty.name} is now ${nextStatus}.`;
            await loadFaculty();
        }

        if (button.dataset.action === "reset") {
            await sendPasswordResetEmail(getAuth(), faculty.email);
            facultyMessage.textContent = `Password reset email sent to ${faculty.email}.`;
        }
    } catch (error) {
        console.error("Faculty action error:", error);
        facultyMessage.textContent = "Unable to update this faculty account.";
    } finally {
        button.disabled = false;
    }
});

async function loadFaculty() {
    facultyMessage.textContent = "Loading faculty accounts...";
    const snapshot = await getDocs(query(collection(db, "users"), where("role", "==", "faculty")));
    facultyAccounts = snapshot.docs.map(documentSnapshot => ({
        uid: documentSnapshot.id,
        ...documentSnapshot.data()
    }));

    facultyTableBody.innerHTML = "";
    if (!facultyAccounts.length) {
        facultyTableBody.innerHTML = '<tr><td colspan="5" class="empty-history">No faculty accounts are stored yet.</td></tr>';
        facultyMessage.textContent = "";
        return;
    }

    facultyAccounts.forEach(faculty => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>
                <button type="button" data-action="toggle" data-uid="${faculty.uid}">${faculty.status === "active" ? "Deactivate" : "Activate"}</button>
                <button type="button" data-action="reset" data-uid="${faculty.uid}">Reset password</button>
            </td>
        `;
        row.children[0].textContent = faculty.name || "Faculty";
        row.children[1].textContent = faculty.email || "Not provided";
        row.children[2].textContent = faculty.department || "Not provided";
        row.children[3].textContent = faculty.status || "unknown";
        facultyTableBody.appendChild(row);
    });

    facultyMessage.textContent = `${facultyAccounts.length} faculty account(s) found.`;
}
