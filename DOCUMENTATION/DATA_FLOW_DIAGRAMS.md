# DENR Permit System - Data Flow Diagrams & Flowcharts

## Table of Contents
1. [System Architecture Overview](#1-system-architecture-overview)
2. [User Role Flows](#2-user-role-flows)
3. [Page-Level CRUD Operations](#3-page-level-crud-operations)
4. [Event Flow Diagrams](#4-event-flow-diagrams)
5. [Database Schema Relationships](#5-database-schema-relationships)

---

## 1. System Architecture Overview

### 1.1 High-Level System Architecture

```mermaid
flowchart TB
    subgraph CLIENT["🖥️ CLIENT LAYER"]
        UI["Web Browser\n(HTML/CSS/JS)"]
        AUTH["Firebase Auth\n(Client SDK)"]
        FIRESTORE_CLIENT["Firestore\n(Client SDK)"]
    end

    subgraph SERVER["⚙️ SERVER LAYER\n(Node.js/Express)"]
        API["REST API Endpoints"]
        MIDDLEWARE["Auth Middleware\n(verifyToken)"]
        CLOUDINARY_API["Cloudinary API"]
    end

    subgraph EXTERNAL["🔌 EXTERNAL SERVICES"]
        FIREBASE_ADMIN["Firebase Admin SDK\n(Auth + Firestore)"]
        CLOUDINARY["Cloudinary\n(File Storage)"]
    end

    subgraph DATABASE["💾 DATABASE LAYER\n(Firebase)"]
        USERS_COL["users Collection"]
        APPS_COL["applications Collection"]
        AUDIT_COL["auditLogs Collection"]
        CONTENT_COL["websiteContent Collection"]
        SETTINGS_COL["systemSettings Collection"]
    end

    UI --> AUTH
    UI --> FIRESTORE_CLIENT
    UI --> API
    API --> MIDDLEWARE
    MIDDLEWARE --> FIREBASE_ADMIN
    API --> CLOUDINARY_API
    CLOUDINARY_API --> CLOUDINARY
    FIREBASE_ADMIN --> USERS_COL
    FIREBASE_ADMIN --> APPS_COL
    FIREBASE_ADMIN --> AUDIT_COL
    FIREBASE_ADMIN --> CONTENT_COL
    FIREBASE_ADMIN --> SETTINGS_COL
    FIRESTORE_CLIENT --> DATABASE
```

### 1.2 Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant FirebaseAuth
    participant Firestore
    participant Server
    participant AdminSDK

    User->>Browser: Enter credentials
    Browser->>FirebaseAuth: signInWithEmailAndPassword()
    FirebaseAuth-->>Browser: ID Token + User Data
    Browser->>Firestore: getDoc(users/{uid})
    Firestore-->>Browser: User role (customer/staff/admin)
    
    alt Token Required for API
        Browser->>Server: API Request + Bearer Token
        Server->>AdminSDK: verifyIdToken(token)
        AdminSDK-->>Server: Decoded claims (uid, email, role)
        Server->>Server: Check role permissions
        Server-->>Browser: Protected Data/Action
    end
    
    Browser->>Browser: Redirect to role-based dashboard
```

---

## 2. User Role Flows

### 2.1 Customer Workflow

```mermaid
flowchart TD
    START([Start]) --> LANDING[Visit Landing Page]
    LANDING --> AUTH{Authenticated?}
    
    AUTH -->|No| LOGIN[Login/Register]
    LOGIN --> VERIFY{Email Verified?}
    VERIFY -->|No| EMAIL_VERIFY[Send Verification Email]
    EMAIL_VERIFY --> WAIT[Wait for Verification]
    VERIFY -->|Yes| DASHBOARD[Customer Dashboard]
    AUTH -->|Yes| DASHBOARD
    
    DASHBOARD --> CHOOSE_ACTION{Choose Action}
    
    CHOOSE_ACTION -->|New Application| NEW_APP[New Application Form]
    NEW_APP --> FILL_FORM[Fill Application Details]
    FILL_FORM --> UPLOAD_DOCS[Upload Required Documents]
    UPLOAD_DOCS --> CLOUDINARY_UPLOAD["Upload to Cloudinary\nPOST /upload-file-to-cloudinary"]
    CLOUDINARY_UPLOAD --> SAVE["Save Application\naddDoc(applications)"]
    SAVE --> NOTIFY["Create Notification\nin Firestore"]
    NOTIFY --> DASHBOARD
    
    CHOOSE_ACTION -->|View My Apps| VIEW_APPS[View My Applications]
    VIEW_APPS --> APP_STATUS{Application Status}
    
    APP_STATUS -->|Pending/Draft| EDIT["Edit Application\nupdateDoc()"]
    APP_STATUS -->|Needs Revision| REVISE["Revise Application\nupdateDoc() + Resubmit"]
    APP_STATUS -->|Under Review| VIEW_ONLY[View Only]
    APP_STATUS -->|Approved| DOWNLOAD[Download Permit]
    APP_STATUS -->|Rejected| VIEW_REASON[View Rejection Reason]
    
    EDIT --> DASHBOARD
    REVISE --> DASHBOARD
    VIEW_ONLY --> DASHBOARD
    DOWNLOAD --> DASHBOARD
    VIEW_REASON --> DASHBOARD
    
    CHOOSE_ACTION -->|Track Status| TRACK[Track Application Status]
    TRACK --> DASHBOARD
    
    CHOOSE_ACTION -->|Profile| PROFILE[Update Profile]
    PROFILE --> DASHBOARD
    
    CHOOSE_ACTION -->|Logout| LOGOUT["signOut()"]
    LOGOUT --> END([End])
```

### 2.2 Staff Workflow

```mermaid
flowchart TD
    START([Start]) --> LOGIN["Login\nsignInWithEmailAndPassword()"]
    LOGIN --> VERIFY_ROLE{Role = staff?}
    VERIFY_ROLE -->|No| ACCESS_DENIED[Access Denied]
    VERIFY_ROLE -->|Yes| STAFF_DASH[Staff Dashboard]
    
    STAFF_DASH --> MENU{Menu Selection}
    
    MENU -->|Active Applications| ACTIVE_APPS["View Active Apps\nPending | Under Review | Needs Revision"]
    ACTIVE_APPS --> SELECT_APP[Select Application]
    SELECT_APP --> VIEW_DETAILS["View Application Details\nDocuments, Timeline, Info"]
    
    VIEW_DETAILS --> ACTION{Action}
    
    ACTION -->|Approve| APPROVE["Quick Approve\nPOST /staff/updateApplicationStatus"]
    APPROVE --> SET_PICKUP[Set Pickup Schedule]
    APPROVE --> AUDIT_APPROVE["Log Audit: Approved Application"]
    
    ACTION -->|Reject| REJECT["Quick Reject\nPOST /staff/updateApplicationStatus"]
    REJECT --> REASON[Enter Rejection Reason]
    REJECT --> AUDIT_REJECT["Log Audit: Rejected Application"]
    
    ACTION -->|Needs Revision| REVISION["Mark Needs Revision\nPOST /staff/updateApplicationStatus"]
    REVISION --> REVISION_NOTES[Enter Revision Notes]
    REVISION --> AUDIT_REVISION["Log Audit: Needs Revision"]
    
    ACTION -->|View Full| FULL_VIEW["Open Full Application View"]
    
    APPROVE --> NOTIFY_CUSTOMER["Update Firestore\nNotify Customer"]
    REJECT --> NOTIFY_CUSTOMER
    REVISION --> NOTIFY_CUSTOMER
    NOTIFY_CUSTOMER --> ACTIVE_APPS
    
    MENU -->|Records| RECORDS["View Approved Records\nHistorical Data"]
    RECORDS --> VIEW_HISTORY[View Past Approvals]
    VIEW_HISTORY --> STAFF_DASH
    
    MENU -->|Archive| ARCHIVE["View Rejected/Archived\nRejected Applications"]
    ARCHIVE --> STAFF_DASH
    
    MENU -->|Notifications| NOTIFICATIONS[View Notifications]
    NOTIFICATIONS --> STAFF_DASH
    
    MENU -->|Logout| LOGOUT["signOut()"]
    LOGOUT --> END([End])
    
    ACCESS_DENIED --> END
```

### 2.3 Admin Workflow

```mermaid
flowchart TD
    START([Start]) --> LOGIN["Login\nsignInWithEmailAndPassword()"]
    LOGIN --> VERIFY_ROLE{Role = admin?}
    VERIFY_ROLE -->|No| CHECK_STAFF{Role = staff?}
    CHECK_STAFF -->|Yes| STAFF_VIEW[Redirect to Staff View]
    CHECK_STAFF -->|No| ACCESS_DENIED[Access Denied]
    VERIFY_ROLE -->|Yes| ADMIN_DASH[Admin Dashboard]
    
    ADMIN_DASH --> MENU{Menu Selection}
    
    MENU -->|Dashboard| DASH_VIEW["View System Overview\nAnalytics & Statistics"]
    DASH_VIEW --> GET_STATS["GET /admin/analytics"]
    GET_STATS --> UPDATE_CHARTS[Update Charts/Graphs]
    UPDATE_CHARTS --> ADMIN_DASH
    
    MENU -->|Applications| APPS_SECTION["Applications Management\nCRUD Operations"]
    APPS_SECTION --> LIST_ALL["List All Applications\nquery(applications)"]
    LIST_ALL --> APP_ACTIONS{Actions}
    APP_ACTIONS -->|View| VIEW_APP["View Application Details"]
    APP_ACTIONS -->|Update Status| UPDATE_STATUS["Update Status\nSame as Staff Flow"]
    APP_ACTIONS -->|Delete| DELETE_APP["Delete Application\ndeleteDoc()"]
    APP_ACTIONS -->|Export| EXPORT_APPS["Export to Excel/PDF"]
    VIEW_APP --> LIST_ALL
    UPDATE_STATUS --> LIST_ALL
    DELETE_APP --> LIST_ALL
    EXPORT_APPS --> LIST_ALL
    
    MENU -->|Records| RECORDS_SECTION["Records Section\nApproved Applications"]
    RECORDS_SECTION --> VIEW_RECORDS["View Historical Records"]
    VIEW_RECORDS --> EXPORT_RECORDS["Export Records"]
    EXPORT_RECORDS --> ADMIN_DASH
    
    MENU -->|Manage Users| USERS_SECTION["User Management\nCRUD Operations"]
    USERS_SECTION --> LIST_USERS["GET /admin/users"]
    LIST_USERS --> USER_ACTIONS{User Actions}
    
    USER_ACTIONS -->|Create Staff| CREATE_STAFF["POST /admin/createStaff"]
    CREATE_STAFF --> ENTER_DETAILS["Enter: email, password, displayName"]
    ENTER_DETAILS --> SET_ROLE["Set Custom Claim: role=staff"]
    SET_ROLE --> SAVE_TO_DB["Save to users Collection"]
    SAVE_TO_DB --> LOG_AUDIT["Log Audit: Staff Account Created"]
    
    USER_ACTIONS -->|View User| VIEW_USER["View User Details"]
    USER_ACTIONS -->|Deactivate| DEACTIVATE["POST /admin/users/{id}/status"]
    USER_ACTIONS -->|Delete| DELETE_USER["Delete User Account"]
    
    LOG_AUDIT --> LIST_USERS
    VIEW_USER --> LIST_USERS
    DEACTIVATE --> LIST_USERS
    DELETE_USER --> LIST_USERS
    
    MENU -->|Reports| REPORTS_SECTION["Reports & Analytics"]
    REPORTS_SECTION --> GENERATE_REPORT["Generate Custom Reports"]
    GENERATE_REPORT --> EXPORT["Export to Excel/PDF"]
    EXPORT --> ADMIN_DASH
    
    MENU -->|Content| CONTENT_SECTION["Content Management"]
    CONTENT_SECTION --> MANAGE_CONTENT{Manage}
    
    MANAGE_CONTENT -->|Announcements| ANNOUNCEMENTS["Manage Announcements\naddDoc/updateDoc/deleteDoc"]
    MANAGE_CONTENT -->|Welcome Message| WELCOME["Update Welcome Message"]
    MANAGE_CONTENT -->|Permit Types| PERMIT_TYPES["Manage Permit Types"]
    MANAGE_CONTENT -->|FAQs| FAQS["Manage FAQs"]
    MANAGE_CONTENT -->|Contact Info| CONTACT["Update Contact Information"]
    
    ANNOUNCEMENTS --> CONTENT_SECTION
    WELCOME --> CONTENT_SECTION
    PERMIT_TYPES --> CONTENT_SECTION
    FAQS --> CONTENT_SECTION
    CONTACT --> CONTENT_SECTION
    
    MENU -->|Audit Logs| AUDIT_SECTION["Audit Log Viewer"]
    AUDIT_SECTION --> GET_LOGS["GET /admin/audit-logs"]
    GET_LOGS --> DISPLAY_LOGS["Display: User, Action, Timestamp, Details"]
    DISPLAY_LOGS --> FILTER_LOGS["Filter by Date/User/Action"]
    FILTER_LOGS --> EXPORT_LOGS["Export Audit Logs"]
    EXPORT_LOGS --> ADMIN_DASH
    
    MENU -->|Settings| SETTINGS_SECTION["System Settings"]
    SETTINGS_SECTION --> SETTINGS_TABS{Settings Tabs}
    
    SETTINGS_TABS -->|Maintenance| MAINTENANCE["Maintenance Mode\nToggle + Message"]
    SETTINGS_TABS -->|Security| SECURITY["Security Settings\nSession Timeout"]
    SETTINGS_TABS -->|Notifications| NOTIFS["Notification Preferences"]
    
    MAINTENANCE --> SAVE_MAINT["saveMaintenanceSettings()\naddDoc/updateDoc systemSettings"]
    SECURITY --> SAVE_SEC["saveSecuritySettings()\naddDoc/updateDoc systemSettings"]
    NOTIFS --> SAVE_NOTIF["saveNotificationSettings()\naddDoc/updateDoc systemSettings"]
    
    SAVE_MAINT --> ADMIN_DASH
    SAVE_SEC --> ADMIN_DASH
    SAVE_NOTIF --> ADMIN_DASH
    
    MENU -->|Logout| LOGOUT["signOut()"]
    LOGOUT --> END([End])
    
    STAFF_VIEW --> END
    ACCESS_DENIED --> END
```

---

## 3. Page-Level CRUD Operations

### 3.1 Customer Dashboard (`customer-dashboard.html`)

```mermaid
flowchart LR
    subgraph PAGE["📄 customer-dashboard.html"]
        subgraph CREATE["➕ CREATE"]
            C1["newApplication()"]
            C2["submitApplication()\n→ addDoc(applications)"]
            C3["uploadToCloudinary()\n→ POST /upload-file-to-cloudinary"]
            C4["saveDraft()\n→ addDoc(applications) status='draft'"]
        end
        
        subgraph READ["📖 READ"]
            R1["loadApplications()\n→ query(applications, where('userId', '==', uid))"]
            R2["getApplicationDetails()\n→ getDoc(applications/{id})"]
            R3["viewDocuments()\n→ fetch from Cloudinary"]
            R4["trackStatus()\n→ onSnapshot for real-time"]
        end
        
        subgraph UPDATE["✏️ UPDATE"]
            U1["editApplication()\n→ getDoc → populate form"]
            U2["saveApplicationChanges()\n→ updateDoc(applications/{id})"]
            U3["resubmitApplication()\n→ updateDoc status='pending'"]
            U4["updateProfile()\n→ updateDoc(users/{uid})"]
        end
        
        subgraph DELETE["🗑️ DELETE"]
            D1["deleteApplication()\n→ deleteDoc(applications/{id})"]
            D2["cancelDraft()\n→ deleteDoc(applications/{id})"]
        end
    end
    
    subgraph DB["💾 Firestore"]
        APPS["applications Collection"]
        USERS["users Collection"]
    end
    
    subgraph STORAGE["☁️ Cloudinary"]
        FILES["Stored Files"]
    end
    
    CREATE --> APPS
    CREATE --> STORAGE
    READ --> APPS
    READ --> STORAGE
    UPDATE --> APPS
    UPDATE --> STORAGE
    DELETE --> APPS
    DELETE --> STORAGE
```

### 3.2 Staff Dashboard (`staff-dashboard.html`)

```mermaid
flowchart LR
    subgraph PAGE["📄 staff-dashboard.html"]
        subgraph CREATE["➕ CREATE"]
            C1["createApprovalAuditLog()\n→ addDoc(auditLogs)"]
            C2["addReviewNotes()\n→ updateDoc with notes"]
        end
        
        subgraph READ["📖 READ"]
            R1["loadActiveApplications()\n→ query where status in ['pending','under review','needs revision']"]
            R2["loadRecords()\n→ query where status='approved'"]
            R3["loadArchive()\n→ query where status='rejected'"]
            R4["viewApplicationDetails()\n→ getDoc + fetch documents"]
            R5["getNotifications()\n→ query(notifications)"]
        end
        
        subgraph UPDATE["✏️ UPDATE"]
            U1["quickApprove()\n→ POST /staff/updateApplicationStatus"]
            U2["quickReject()\n→ POST /staff/updateApplicationStatus"]
            U3["quickNeedsRevision()\n→ POST /staff/updateApplicationStatus"]
            U4["setPickupSchedule()\n→ updateDoc with pickupSchedule"]
            U5["forwardToAdmin()\n→ updateDoc + notify"]
        end
        
        subgraph DELETE["🗑️ DELETE (Limited)"]
            D1["clearNotifications()\n→ deleteDoc(notifications/{id})"]
        end
    end
    
    subgraph SERVER["⚙️ Server API"]
        API["/staff/updateApplicationStatus"]
    end
    
    subgraph DB["💾 Firestore"]
        APPS["applications"]
        AUDIT["auditLogs"]
        NOTIFS["notifications"]
    end
    
    CREATE --> AUDIT
    READ --> APPS
    READ --> NOTIFS
    UPDATE --> API
    API --> APPS
    UPDATE --> AUDIT
    DELETE --> NOTIFS
```

### 3.3 Admin Dashboard (`admin-dashboard.html`)

```mermaid
flowchart LR
    subgraph PAGE["📄 admin-dashboard.html"]
        subgraph CREATE["➕ CREATE"]
            C1["createStaffAccount()\n→ POST /admin/createStaff"]
            C2["addAnnouncement()\n→ addDoc(websiteContent)"]
            C3["addPermitType()\n→ addDoc(websiteContent)"]
            C4["addFAQ()\n→ addDoc(faqs)"]
        end
        
        subgraph READ["📖 READ"]
            R1["loadDashboardStats()\n→ GET /admin/analytics"]
            R2["loadAllApplications()\n→ query(applications)"]
            R3["loadAllUsers()\n→ GET /admin/users"]
            R4["loadAuditLogs()\n→ GET /admin/audit-logs"]
            R5["loadSystemSettings()\n→ query(systemSettings)"]
            R6["loadContent()\n→ query(websiteContent)"]
        end
        
        subgraph UPDATE["✏️ UPDATE"]
            U1["updateUserStatus()\n→ POST /admin/users/{id}/status"]
            U2["updateApplicationStatus()\n→ Same as Staff"]
            U3["updateContent()\n→ updateDoc(websiteContent/{id})"]
            U4["updateSettings()\n→ updateDoc(systemSettings/{id})"]
            U5["updateWelcomeMessage()\n→ updateDoc(websiteContent)"]
            U6["updateContactInfo()\n→ updateDoc(websiteContent)"]
        end
        
        subgraph DELETE["🗑️ DELETE"]
            D1["deleteUser()\n→ admin.auth().deleteUser()"]
            D2["deleteApplication()\n→ deleteDoc(applications/{id})"]
            D3["deleteContent()\n→ deleteDoc(websiteContent/{id})"]
            D4["deleteAuditLog()\n→ deleteDoc(auditLogs/{id})"]
        end
    end
    
    subgraph SERVER["⚙️ Server API"]
        API1["/admin/createStaff"]
        API2["/admin/users"]
        API3["/admin/analytics"]
        API4["/admin/audit-logs"]
    end
    
    subgraph DB["💾 Firestore"]
        APPS["applications"]
        USERS["users"]
        AUDIT["auditLogs"]
        CONTENT["websiteContent"]
        SETTINGS["systemSettings"]
        FAQS["faqs"]
    end
    
    CREATE --> SERVER
    CREATE --> DB
    READ --> SERVER
    READ --> DB
    UPDATE --> SERVER
    UPDATE --> DB
    DELETE --> SERVER
    DELETE --> DB
```

### 3.4 Landing Page (`index.html`) & Public Pages

```mermaid
flowchart LR
    subgraph PAGES["📄 Public Pages"]
        INDEX["index.html"]
        ABOUT["about.html"]
        SERVICES["services.html"]
        FAQ["faq.html"]
        CONTACT["contact.html"]
        PERMIT_TYPES["permit-types.html"]
    end
    
    subgraph READ["📖 READ Operations Only"]
        R1["loadWebsiteContent()\n→ query(websiteContent)"]
        R2["loadAnnouncements()\n→ query where type='announcement'"]
        R3["loadWelcomeMessage()\n→ query where type='welcome'"]
        R4["loadContactInfo()\n→ query where type='contact'"]
        R5["loadPermitTypes()\n→ query where type='permit'"]
        R6["loadFAQs()\n→ query(faqs)"]
    end
    
    subgraph AUTH_ACTIONS["🔐 Auth Actions"]
        A1["showLoginModal()"]
        A2["login()\n→ signInWithEmailAndPassword()"]
        A3["register()\n→ createUserWithEmailAndPassword()"]
        A4["logout()\n→ signOut()"]
        A5["resetPassword()\n→ sendPasswordResetEmail()"]
    end
    
    subgraph DB["💾 Firestore"]
        CONTENT["websiteContent"]
        FAQS["faqs"]
    end
    
    PAGES --> READ
    PAGES --> AUTH_ACTIONS
    READ --> DB
```

---

## 4. Event Flow Diagrams

### 4.1 Application Submission Flow

```mermaid
sequenceDiagram
    actor Customer
    participant Browser
    participant CustomerJS
    participant CloudinaryAPI
    participant Firestore
    participant Server
    participant FirebaseAdmin
    participant StaffDashboard

    Customer->>Browser: Click "New Application"
    Browser->>CustomerJS: openApplicationModal()
    CustomerJS->>Browser: Render Form
    
    Customer->>Browser: Fill Form + Upload Files
    Browser->>CustomerJS: handleFileSelect()
    CustomerJS->>CustomerJS: Validate Files (<5MB)
    
    Customer->>Browser: Click Submit
    Browser->>CustomerJS: submitApplication()
    
    loop For Each File
        CustomerJS->>CloudinaryAPI: POST /upload-file-to-cloudinary
        CloudinaryAPI-->>CustomerJS: Return file URL + public_id
    end
    
    CustomerJS->>Firestore: addDoc(applications)
    Note over CustomerJS,Firestore: Application Data + File URLs + status='pending'
    
    Firestore-->>CustomerJS: Document Reference
    CustomerJS->>Firestore: addDoc(notifications)
    Note over CustomerJS,Firestore: Notification to customer
    
    Firestore-->>StaffDashboard: onSnapshot Trigger
    StaffDashboard->>StaffDashboard: updateStats()
    StaffDashboard->>StaffDashboard: showNotification()
    
    CustomerJS-->>Browser: Show Success Message
    Browser-->>Customer: "Application Submitted Successfully"
```

### 4.2 Application Review & Approval Flow

```mermaid
sequenceDiagram
    actor Staff
    participant StaffDashboard
    participant Server
    participant FirebaseAdmin
    participant Firestore
    participant CustomerDashboard
    actor Customer

    Staff->>StaffDashboard: View Active Applications
    StaffDashboard->>Firestore: query(applications, status='pending')
    Firestore-->>StaffDashboard: List of Applications
    StaffDashboard-->>Staff: Display Applications
    
    Staff->>StaffDashboard: Select Application to Review
    StaffDashboard->>StaffDashboard: viewApplicationDetails()
    StaffDashboard->>Firestore: getDoc(applications/{id})
    Firestore-->>StaffDashboard: Application Data
    StaffDashboard-->>Staff: Show Details + Documents
    
    Staff->>StaffDashboard: Click Approve
    StaffDashboard->>Server: POST /staff/updateApplicationStatus
    Note over StaffDashboard,Server: {applicationId, status='approved', pickupSchedule}
    
    Server->>FirebaseAdmin: verifyIdToken(token)
    FirebaseAdmin-->>Server: Token Valid (role=staff/admin)
    
    Server->>Firestore: Get Current Application
    Firestore-->>Server: Before Data
    
    Server->>Firestore: updateDoc(applications/{id})
    Note over Server,Firestore: status='approved', reviewedBy, reviewedAt, approvedAt, pickupSchedule
    
    Server->>Firestore: addDoc(auditLogs)
    Note over Server,Firestore: Action='Approved Application', before/after data
    
    Firestore-->>CustomerDashboard: onSnapshot Trigger
    CustomerDashboard->>CustomerDashboard: refreshApplications()
    CustomerDashboard->>CustomerDashboard: showNotification()
    
    Server-->>StaffDashboard: {success: true}
    StaffDashboard-->>Staff: "Application Approved Successfully"
    CustomerDashboard-->>Customer: "Your application has been approved!"
```

### 4.3 Staff Account Creation Flow (Admin Only)

```mermaid
sequenceDiagram
    actor Admin
    participant AdminDashboard
    participant Server
    participant FirebaseAdmin
    participant Firestore
    participant Auth
    actor NewStaff

    Admin->>AdminDashboard: Navigate to Manage Users
    AdminDashboard->>Server: GET /admin/users
    Server->>FirebaseAdmin: verifyIdToken(token)
    FirebaseAdmin-->>Server: Token Valid (role=admin)
    
    Server->>Firestore: query(users)
    Firestore-->>Server: User List
    Server-->>AdminDashboard: Display Users
    
    Admin->>AdminDashboard: Click "Create Staff Account"
    AdminDashboard->>AdminDashboard: openCreateStaffModal()
    
    Admin->>AdminDashboard: Enter: email, password, displayName
    Admin->>AdminDashboard: Click Submit
    
    AdminDashboard->>Server: POST /admin/createStaff
    Note over AdminDashboard,Server: {email, password, displayName}
    
    Server->>FirebaseAdmin: verifyIdToken(token)
    FirebaseAdmin-->>Server: Token Valid (role=admin)
    
    Server->>Auth: createUser({email, password, displayName})
    Auth-->>Server: New User Record (uid)
    
    Server->>Auth: setCustomUserClaims(uid, {role: 'staff'})
    Auth-->>Server: Success
    
    Server->>Firestore: setDoc(users/{uid})
    Note over Server,Firestore: {email, displayName, role: 'staff', createdAt}
    
    Server->>Firestore: addDoc(auditLogs)
    Note over Server,Firestore: Action='Staff Account Created'
    
    Server-->>AdminDashboard: {uid, email}
    AdminDashboard-->>Admin: "Staff account created successfully"
    
    Note over NewStaff: Staff receives credentials
    NewStaff->>Auth: Login with new credentials
    Auth-->>NewStaff: Token with role='staff'
```

### 4.4 Content Management Flow

```mermaid
sequenceDiagram
    actor Admin
    participant AdminDashboard
    participant Firestore
    participant PublicPage
    actor PublicUser

    Admin->>AdminDashboard: Navigate to Content Management
    AdminDashboard->>Firestore: query(websiteContent)
    Firestore-->>AdminDashboard: Current Content
    AdminDashboard-->>Admin: Display Content Editor
    
    Admin->>AdminDashboard: Select Content Type
    Note over Admin,AdminDashboard: Announcement/Welcome/Permit Type/FAQ/Contact
    
    alt Create New
        Admin->>AdminDashboard: Fill Content Form
        Admin->>AdminDashboard: Click Save
        AdminDashboard->>Firestore: addDoc(websiteContent)
        Firestore-->>AdminDashboard: Document Created
    else Update Existing
        Admin->>AdminDashboard: Edit Content
        Admin->>AdminDashboard: Click Update
        AdminDashboard->>Firestore: updateDoc(websiteContent/{id})
        Firestore-->>AdminDashboard: Document Updated
    else Delete
        Admin->>AdminDashboard: Click Delete
        AdminDashboard->>Firestore: deleteDoc(websiteContent/{id})
        Firestore-->>AdminDashboard: Document Deleted
    end
    
    AdminDashboard->>Firestore: addDoc(auditLogs)
    Note over AdminDashboard,Firestore: Log content change
    
    Firestore-->>PublicPage: onSnapshot Trigger
    PublicPage->>PublicPage: loadWebsiteContent()
    PublicPage->>Firestore: query(websiteContent)
    Firestore-->>PublicPage: Updated Content
    
    PublicPage-->>PublicUser: Display Updated Content
    AdminDashboard-->>Admin: "Content saved successfully"
```

### 4.5 File Upload & Storage Flow

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant CustomerJS
    participant Server
    participant Cloudinary
    participant Firestore

    User->>Browser: Select File for Upload
    Browser->>CustomerJS: handleFileSelect(event)
    CustomerJS->>CustomerJS: validateFile()
    Note over CustomerJS: Check size < 5MB, type
    
    alt File Valid
        CustomerJS-->>Browser: Show Preview
        User->>Browser: Click Submit Application
        Browser->>CustomerJS: submitApplication()
        
        CustomerJS->>Server: POST /upload-file-to-cloudinary
        Note over CustomerJS,Server: FormData: file, folder='denr-permits'
        
        Server->>Server: multer middleware
        Server->>Server: Buffer to Base64 conversion
        Server->>Cloudinary: uploadFromBase64()
        Cloudinary-->>Server: Upload Result
        Note over Cloudinary,Server: {url, public_id, format, size}
        
        Server-->>CustomerJS: {success, url, public_id}
        CustomerJS->>Firestore: Save URL in application document
    else File Invalid
        CustomerJS-->>Browser: Show Error Message
        Browser-->>User: "File too large or invalid type"
    end
```

---

## 5. Database Schema Relationships

### 5.1 Entity Relationship Diagram

```mermaid
erDiagram
    USERS {
        string uid PK
        string email
        string displayName
        string role "customer|staff|admin"
        timestamp createdAt
        string status "active|inactive"
    }
    
    APPLICATIONS {
        string id PK
        string userId FK
        string applicantName
        string email
        string permitType
        string status "pending|under_review|approved|rejected|needs_revision"
        object documents "Array of {name, url, public_id}"
        timestamp createdAt
        timestamp updatedAt
        string reviewedBy
        timestamp reviewedAt
        string approvedBy
        timestamp approvedAt
        string rejectedBy
        timestamp rejectedAt
        string rejectionReason
        object pickupSchedule
        boolean isDraft
    }
    
    AUDITLOGS {
        string id PK
        string userId FK
        string userEmail
        string role
        string action
        string details
        string category
        string resourceId
        object beforeData
        object afterData
        string status
        timestamp timestamp
        string ip
        string userAgent
        string module
    }
    
    NOTIFICATIONS {
        string id PK
        string userId FK
        string title
        string message
        string type
        boolean read
        timestamp createdAt
        string relatedId
    }
    
    WEBSITECONTENT {
        string id PK
        string type "welcome|contact|office|announcement|permit"
        string title
        string message
        string content
        array requirements
        string processingTime
        string fee
        boolean active
        timestamp createdAt
        timestamp updatedAt
    }
    
    FAQS {
        string id PK
        string question
        string answer
        string category
        int order
        boolean active
        timestamp createdAt
    }
    
    SYSTEMSETTINGS {
        string id PK
        string type "maintenance|security|notifications"
        boolean enabled
        string message
        int sessionTimeout
        boolean newApplications
        boolean approvals
        boolean rejections
        boolean dailyReports
        timestamp updatedAt
    }
    
    USERS ||--o{ APPLICATIONS : "submits"
    USERS ||--o{ AUDITLOGS : "generates"
    USERS ||--o{ NOTIFICATIONS : "receives"
    APPLICATIONS ||--o{ AUDITLOGS : "tracked in"
```

### 5.2 Data Flow by Collection

```mermaid
flowchart LR
    subgraph INPUT["📥 Data Input Sources"]
        CUSTOMER["Customer Actions"]
        STAFF["Staff Actions"]
        ADMIN["Admin Actions"]
        SYSTEM["System Events"]
    end
    
    subgraph COLLECTIONS["💾 Firestore Collections"]
        USERS["users\nUser accounts & roles"]
        APPS["applications\nPermit applications"]
        AUDIT["auditLogs\nActivity tracking"]
        NOTIFS["notifications\nUser alerts"]
        CONTENT["websiteContent\nCMS data"]
        FAQS["faqs\nFAQ entries"]
        SETTINGS["systemSettings\nConfiguration"]
    end
    
    subgraph OUTPUT["📤 Data Output"]
        DASHBOARDS["Role-based Dashboards"]
        REPORTS["Reports & Analytics"]
        PUBLIC["Public Website"]
    end
    
    CUSTOMER -->|create| USERS
    CUSTOMER -->|CRUD| APPS
    CUSTOMER -->|trigger| NOTIFS
    
    STAFF -->|read/update| APPS
    STAFF -->|create| AUDIT
    STAFF -->|trigger| NOTIFS
    
    ADMIN -->|CRUD| USERS
    ADMIN -->|CRUD| APPS
    ADMIN -->|create| AUDIT
    ADMIN -->|CRUD| CONTENT
    ADMIN -->|CRUD| FAQS
    ADMIN -->|CRUD| SETTINGS
    ADMIN -->|read| AUDIT
    
    SYSTEM -->|auto| AUDIT
    SYSTEM -->|auto| NOTIFS
    
    USERS --> DASHBOARDS
    APPS --> DASHBOARDS
    APPS --> REPORTS
    AUDIT --> REPORTS
    CONTENT --> PUBLIC
    FAQS --> PUBLIC
    SETTINGS --> DASHBOARDS
```

---

## Appendix: API Endpoint Summary

### Authentication Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| Firebase Auth SDK | - | Client-side auth | No |

### Customer Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| Firestore SDK | - | CRUD operations | Yes |
| `/upload-file-to-cloudinary` | POST | File upload | Yes |

### Staff Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/staff/updateApplicationStatus` | POST | Update application status | Yes (staff/admin) |

### Admin Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/admin/createStaff` | POST | Create staff account | Yes (admin) |
| `/admin/verify-role` | GET | Verify user role | Yes |
| `/admin/analytics` | GET | Get dashboard stats | Yes (admin/staff) |
| `/admin/users` | GET | List all users | Yes (admin) |
| `/admin/users/:id/status` | POST | Update user status | Yes (admin) |
| `/admin/audit-logs` | GET | Get audit logs | Yes (admin) |
| `/admin/audit-log` | POST | Create audit log | Yes |

### File Management Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/upload-file-to-cloudinary` | POST | Upload file | Yes |
| `/upload-to-cloudinary` | POST | Upload base64 | Yes |
| `/delete-from-cloudinary/:id` | DELETE | Delete file | Yes |
| `/download-file/:id/:filename` | GET | Download file | Yes |

### Debug Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/debug/my-role` | GET | Check current role | Yes |
| `/debug/set-staff-role` | POST | Set staff role (testing) | Yes |
| `/debug/create-audit-log` | POST | Create test audit log | Yes |
| `/health` | GET | Health check | No |
