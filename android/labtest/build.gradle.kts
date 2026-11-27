plugins {
    id("com.android.application")
}

// Plain Java and no libraries on purpose: this APK is loaded into the app's own process on a
// device farm, next to a shrunk build of the app, so it must not share any library with it.
android {
    namespace = "io.github.pawelmpuc.privateclaimcheck.labtest"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.pawelmpuc.privateclaimcheck.labtest"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        // LabRun runs the hands-free self-test. Build with -Pdemo for LabDemo, which walks through the app's screens.
        manifestPlaceholders["runner"] = if (project.hasProperty("demo")) ".LabDemo" else ".LabRun"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
