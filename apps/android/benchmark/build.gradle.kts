import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "com.physicsos.student.benchmark.tests"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    targetProjectPath = ":app"
    experimentalProperties["android.experimental.self-instrumenting"] = true

    defaultConfig {
        minSdk = 29
        targetSdk = 36
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "TARGET_PACKAGE", "\"com.physicsos.student.benchmark\"")
        // Deliberately do not suppress EMULATOR, DEBUGGABLE, or PROFILEABLE errors.
    }
    buildTypes {
        create("benchmarkRelease") {
            isDebuggable = true // Test APK only; measured app is nondebuggable.
            matchingFallbacks += "release"
        }
        create("nonMinifiedRelease") {
            isDebuggable = true
            matchingFallbacks += "release"
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

androidComponents {
    beforeVariants(selector().all()) { variant ->
        variant.enable = variant.buildType in setOf("benchmarkRelease", "nonMinifiedRelease")
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
}

baselineProfile {
    useConnectedDevices = true
    // No managed emulator: functional emulator tests are not performance proof.
}

dependencies {
    implementation(libs.androidx.benchmark.macro.junit4)
    implementation(libs.androidx.test.runner)
    implementation(libs.androidx.test.rules)
    implementation(libs.androidx.test.junit.ktx)
    implementation(libs.androidx.test.uiautomator)
    implementation(libs.junit)
}
