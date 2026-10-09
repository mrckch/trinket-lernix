// Rollen und Rechte für Trinket Lernix.
//
// Site-Rollen (Kontext "site"):
//   student – IServ-Konto ohne Lehrkraft-Marker: eigene Trinkets, Kurse beitreten, Aufgaben abgeben
//   teacher – IServ-Konto mit Lehrkraft-Marker: zusätzlich Kurse anlegen, Aufgaben stellen, Dashboard
//   admin   – nur in der App vergeben (nie aus IServ): zusätzlich /admin; geprüft über hasRole('admin')
// Kursrollen (Kontext "course:<id>") und Ordnerrollen bleiben wie in trinket-oss.
//
// Welche Trinket-Typen tatsächlich angeboten werden, entscheidet zusätzlich features.trinkets.*

var STUDENT_TRINKETS = [
    'create-python-trinket'
  , 'create-html-trinket'
  , 'create-blocks-trinket'
  , 'create-glowscript-trinket'
  , 'create-glowscript-blocks-trinket'
];

var TEACHER_EXTRA = [
    'create-python3-trinket'
  , 'create-music-trinket'
  , 'create-java-trinket'
  , 'create-pygame-trinket'
  , 'create-R-trinket'
  , 'create-public-course'
  , 'create-private-course'
  , 'hide-trinket-files'
  , 'enable-trinket-tests'
  , 'add-trinket-inline-comments'
  , 'course-assignments'
];

var TEACHER = STUDENT_TRINKETS.concat(TEACHER_EXTRA);

// role : [ permissions ]
var permissions = {
    'student' : STUDENT_TRINKETS
  , 'teacher' : TEACHER
  , 'admin'   : TEACHER
    // Course roles
  , 'course-owner' : [
        'update-course-details'
      , 'manage-course-access'
      , 'change-course-owner'
      , 'manage-course-content'
      , 'view-course-content'
      , 'delete-course'
      , 'manage-course-assignments'
      , 'view-assignment-submissions'
      , 'send-submission-feedback'
    ]
  , 'course-collaborator' : [
        'manage-course-content'
      , 'view-course-content'
    ]
  , 'course-admin' : [
        'update-course-details'
      , 'manage-course-access'
      , 'manage-course-content'
      , 'view-course-content'
      , 'manage-course-assignments'
      , 'view-assignment-submissions'
      , 'send-submission-feedback'
    ]
  , 'course-student' : [
        'view-course-content'
    ]
  , 'course-associate' : [
        'make-course-copy'
      , 'view-course-content'
    ]
    // Folder roles
  , 'folder-owner' : [
        'add-trinket'
      , 'update-folder-details'
    ]
};

// Altbestand aus trinket-oss: 'user' und die trinket.io-Abos entsprechen der Lehrkraft.
permissions['user'] = TEACHER;
permissions['trinket-code'] = TEACHER;
permissions['trinket-connect'] = TEACHER;
permissions['trinket-connect-trial'] = TEACHER;
permissions['trinket-codeplus'] = TEACHER;
permissions['trinket-teacher'] = TEACHER;

module.exports = {
    SITE_ROLES : ['student', 'teacher', 'admin']
  , getPermissions : function(role) {
      return Promise.resolve(permissions[role] || []);
    }
  , getLimits : function(role) {
      // Keine Kontingente in Trinket Lernix
      return Promise.resolve(undefined);
    }
  , getCheck : function(permission) {
      return undefined;
    }
};
