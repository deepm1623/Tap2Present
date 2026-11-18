import { requireRole, logout } from "../auth.js";
import { db } from "../../firebase-config.js";
import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const session = await requireRole("faculty");
document.querySelector("[data-logout]").addEventListener("click", async (event) => {
    event.preventDefault();
    await logout();
});

const classesMessage = document.getElementById("classesMessage");
const classesList = document.getElementById("classesList");

try {
    const [sessionsSnapshot, studentsSnapshot] = await Promise.all([
        getDocs(query(collection(db, "sessions"), where("facultyId", "==", session.user.uid))),
        getDocs(query(collection(db, "users"), where("role", "==", "student")))
    ]);

    const classes = new Map();
    sessionsSnapshot.docs.forEach(sessionDocument => {
        const data = sessionDocument.data();
        const className = data.className || data.classId || data.class;
        if (!className) return;
        const key = `${className}|${data.semester ?? ""}|${data.division || ""}`;
        const entry = classes.get(key) || {
            className,
            semester: data.semester ?? "Not set",
            division: data.division || "Not set",
            sessions: 0,
            subjects: new Set()
        };
        entry.sessions += 1;
        if (data.subjectName || data.subject) {
            entry.subjects.add(data.subjectName || data.subject);
        }
        classes.set(key, entry);
    });

    if (!classes.size) {
        classesList.innerHTML = '<p class="empty-history">No assigned classes yet. Start an attendance session to record a class here.</p>';
        classesMessage.textContent = "";
    } else {
        classesList.replaceChildren();
        classes.forEach(entry => {
            const studentCount = studentsSnapshot.docs.filter(studentDocument => {
                const student = studentDocument.data();
                const studentClass = student.className || student.classId || student.class || student.department || "";
                return studentClass === entry.className
                    && String(student.semester ?? "") === String(entry.semester === "Not set" ? "" : entry.semester)
                    && String(student.division || "") === String(entry.division === "Not set" ? "" : entry.division);
            }).length;

            const card = document.createElement("article");
            card.className = "subject-card";
            card.style.marginTop = "12px";
            const title = document.createElement("h3");
            title.textContent = entry.className;
            const meta = document.createElement("p");
            meta.className = "empty-history";
            meta.textContent = `Semester ${entry.semester} · Division ${entry.division} · ${entry.sessions} session(s) · ${studentCount} matching student(s) · ${[...entry.subjects].join(", ") || "No subjects yet"}`;
            card.append(title, meta);
            classesList.appendChild(card);
        });
        classesMessage.textContent = `${classes.size} class group(s) found from your sessions.`;
    }
} catch (error) {
    console.error("Manage classes load error:", error);
    classesMessage.textContent = error.code === "permission-denied"
        ? "Firestore permission error. Unable to load class information."
        : "Unable to load assigned classes.";
    classesList.innerHTML = '<p class="empty-history">Assigned classes are unavailable.</p>';
}
