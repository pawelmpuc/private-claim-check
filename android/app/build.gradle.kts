import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firebase is configured from a git-ignored properties file, so no key lives in the repository.
val firebase = Properties().apply {
    val file = rootProject.file("firebase.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun fb(key: String): String = "\"${(firebase.getProperty(key) ?: "").trim()}\""

android {
    namespace = "io.github.pawelmpuc.privateclaimcheck"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.pawelmpuc.privateclaimcheck"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "FIREBASE_API_KEY", fb("apiKey"))
        buildConfigField("String", "FIREBASE_APP_ID", fb("applicationId"))
        buildConfigField("String", "FIREBASE_PROJECT_ID", fb("projectId"))
        // Optional. An App Check debug token registered in the Firebase console, so one build works on any phone.
        buildConfigField("String", "APPCHECK_DEBUG_TOKEN", fb("appCheckDebugToken"))
    }
    buildTypes {
        // Same as debug (debug signing key, App Check debug provider), but shrunk with R8.
        // Small enough to upload to a device farm from a browser.
        create("lab") {
            initWith(getByName("debug"))
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            matchingFallbacks += "debug"
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // Firebase AI Logic: cloud models and, on supported phones, Gemini Nano on the device.
    implementation("com.google.firebase:firebase-ai:18.2.0")
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
    implementation("com.google.firebase:firebase-appcheck-debug:20.1.0")
}
