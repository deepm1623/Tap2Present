import { setupStudentPortal } from "./student-portal.js";

await setupStudentPortal();
const feature = document.body.dataset.feature;
const message = document.getElementById("featureMessage");

const descriptions = {
    timetable: "No timetable collection or faculty timetable workflow is configured yet.",
    notifications: "No notification collection or notification publisher is configured yet.",
    announcements: "No announcement collection or admin/faculty announcement workflow is configured yet."
};

message.textContent = descriptions[feature] || "This feature is not configured yet.";
