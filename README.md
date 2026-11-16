# Tap2Present

Tap2Present is a hybrid smart attendance portal for students, faculty, and administrators.

## Structure

- `index.html` is the landing page.
- `student/`, `faculty/`, and `admin/` contain the active portal pages.
- `css/` contains shared, landing, authentication, and page-specific styles.
- `js/` contains the shared Firebase auth guard and portal modules.
- `components/global-popups.html` and `js/Common/popups.js` provide shared dialogs and toasts.
- `firebase-config.js` contains the existing Firebase project configuration.

## Authentication

Email/password authentication is handled by Firebase Authentication. Each signed-in user must have a matching `users/{uid}` Firestore document with the expected `role` and an `active` `status`. Role assignment remains a trusted administrative responsibility.

The faculty attendance page reads NDEF text records in the `TAP2P:STUDENT_ID` format, verifies the student profile, and writes a present record to the `attendance` collection. Student dashboards and history pages read those records. Class/session management, absent calculation, and reporting remain prototype roadmap items.

## Live attendance sessions

The faculty NFC page creates an automatic-ID document in `sessions` after the NFC scanner starts:

- `facultyUid`, `facultyName`
- `subject` and `subjectName`
- `status` (`active` or `stopped`)
- `startedAt` and `endedAt`
- optional `classId`, `className`, `semester`, and `division` copied from the faculty profile

Stopping the scanner updates the same document rather than creating another session. The student Mark Attendance page listens to `sessions` with `onSnapshot()`, filters supported class fields against the student's profile, and renders active, ended, empty, loading, and error states. Students never write to `sessions` or `attendance`.

No Firestore rules file is present in this repository. The deployed rules must allow authenticated faculty users to create/update only their own session documents and allow students to read only sessions whose class, semester, and division match their `users/{uid}` profile (or sessions without those optional fields). The existing attendance rules must remain unchanged.

Run the site through a local web server so browser module imports, the shared popup component, and Firebase requests work correctly. NFC scanning also requires HTTPS and a supported Android browser.

## Student portal status

The student portal provides guarded dashboard, subject summaries, attendance overview, filtered history, profile updates for phone numbers, password reset, and read-only NFC card information. Timetable, notifications, and announcements currently show dependency-aware empty states because no corresponding collections or Admin/Faculty publishing workflows exist in this repository.
