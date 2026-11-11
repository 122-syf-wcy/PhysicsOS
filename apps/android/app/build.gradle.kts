import java.net.URI
import groovy.json.JsonSlurper
import org.gradle.api.GradleException
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
    alias(libs.plugins.baselineprofile)
}

val publicOrigin = providers.gradleProperty("physicsos.serverOrigin")
    .orElse(providers.environmentVariable("PHYSICSOS_ANDROID_SERVER_ORIGIN"))
    .orElse("https://physics.dongsiwei.com")
    .get().trimEnd('/')
val originUri = runCatching { URI(publicOrigin) }.getOrNull()
require(originUri != null && originUri.scheme == "https" && !originUri.host.isNullOrBlank() &&
    originUri.rawUserInfo == null && originUri.rawQuery == null && originUri.rawFragment == null &&
    originUri.rawPath.isNullOrEmpty()) {
    "physicsos.serverOrigin must be an HTTPS origin without credentials, path, query, or fragment."
}
val mobileApiBase = "$publicOrigin/physicsos/mobile/v1/"
val mobileLabOutput = rootProject.layout.projectDirectory.dir("../mobile-lab/dist")
val bundledLabAssets = layout.buildDirectory.dir("generated/mobileLabAssets")
val verifyBundledLab = tasks.register("verifyBundledLab") {
    group = "verification"
    description = "Require the independently built experiment and document bundle before packaging."
    inputs.dir(mobileLabOutput).optional()
    inputs.file(rootProject.layout.projectDirectory.file("../mobile-lab/shared-source.json"))
    doLast {
        for (relative in listOf("lab/index.html", "lab/document.html", "lab/catalog.json", "lab/library.json", "lab/manifest.json")) {
            val asset = mobileLabOutput.file(relative).asFile
            if (!asset.isFile || asset.length() == 0L) {
                throw GradleException(
                    "Missing bundled learning asset: $relative. Run node scripts/android/build-lab.mjs " +
                        "on this workstation before the Android package. An online website is not a replacement.",
                )
            }
        }
        val manifest = JsonSlurper().parse(mobileLabOutput.file("lab/manifest.json").asFile) as? Map<*, *>
        if (manifest?.get("version") != 1 || manifest["test"] != false) {
            throw GradleException("Refusing browser-test lab assets in an APK. Rebuild without --test.")
        }
        val expectedSource = JsonSlurper().parse(rootProject.layout.projectDirectory.file("../mobile-lab/shared-source.json").asFile) as Map<*, *>
        if (manifest["sourceCommit"] != expectedSource["commit"] || manifest["packagesTree"] != expectedSource["packagesTree"] || manifest["uiTree"] != expectedSource["uiTree"]) {
            throw GradleException("The bundled lab is not built from the reviewed Web snapshot. Prepare shared sources and rebuild the lab.")
        }
    }
}
val stageBundledLab = tasks.register<Sync>("stageBundledLab") {
    dependsOn(verifyBundledLab)
    from(mobileLabOutput)
    into(bundledLabAssets)
}
val requestedVersionCode = providers.environmentVariable("PHYSICSOS_ANDROID_VERSION_CODE")
    .orElse("1").get().toIntOrNull()
require(requestedVersionCode != null && requestedVersionCode in 1..2_100_000_000) {
    "PHYSICSOS_ANDROID_VERSION_CODE must be a positive Android version code."
}

// Mounted secret files take precedence. Never pass passwords through -P or log them.
fun signingSecret(valueVariable: String, fileVariable: String): String? {
    val secretFile = providers.environmentVariable(fileVariable).orNull?.takeIf { it.isNotBlank() }
    if (secretFile != null) {
        return runCatching {
            val mounted = file(secretFile)
            require(mounted.isFile && mounted.canRead() && mounted.length() in 1..16_384)
            mounted.readText(Charsets.UTF_8).trimEnd('\r', '\n').takeIf { it.isNotEmpty() }
        }.getOrNull()
    }
    return providers.environmentVariable(valueVariable).orNull?.takeIf { it.isNotEmpty() }
}

val signingStorePath = providers.environmentVariable("PHYSICSOS_ANDROID_KEYSTORE_FILE")
    .orNull?.takeIf { it.isNotBlank() }
val signingKeyAlias = providers.environmentVariable("PHYSICSOS_ANDROID_KEY_ALIAS")
    .orNull?.takeIf { it.isNotBlank() }
val signingStorePassword = signingSecret(
    "PHYSICSOS_ANDROID_STORE_PASSWORD", "PHYSICSOS_ANDROID_STORE_PASSWORD_FILE",
)
val signingKeyPassword = signingSecret(
    "PHYSICSOS_ANDROID_KEY_PASSWORD", "PHYSICSOS_ANDROID_KEY_PASSWORD_FILE",
)
val signingStore = signingStorePath?.let { file(it) }

val validateReleaseSigning = tasks.register("validateReleaseSigning") {
    group = "verification"
    description = "Require real mounted release credentials; never substitute debug signing."
    doLast {
        if (signingStore == null || !signingStore.isFile || !signingStore.canRead() ||
            signingKeyAlias == null || signingStorePassword == null || signingKeyPassword == null
        ) {
            throw GradleException(
                "Release signing is unavailable. Mount a readable PHYSICSOS_ANDROID_KEYSTORE_FILE, " +
                    "set PHYSICSOS_ANDROID_KEY_ALIAS, and provide " +
                    "PHYSICSOS_ANDROID_STORE_PASSWORD_FILE / PHYSICSOS_ANDROID_KEY_PASSWORD_FILE " +
                    "(or the corresponding password environment variables). " +
                    "Debug and benchmarkRelease use separate test signing; an unsigned release is not a release.",
            )
        }
    }
}

android {
    namespace = "com.physicsos.student"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.physicsos.student"
        minSdk = 29
        targetSdk = 36
        versionCode = requestedVersionCode
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
        buildConfigField("String", "SERVER_ORIGIN", "\"$publicOrigin\"")
        buildConfigField("String", "MOBILE_API_BASE_URL", "\"$mobileApiBase\"")
        buildConfigField("int", "MOBILE_API_VERSION", "1")
        buildConfigField("boolean", "IS_BENCHMARK_BUILD", "false")
    }

    val releaseSigning = signingConfigs.create("release") {
        storeFile = signingStore
        storePassword = signingStorePassword
        keyAlias = signingKeyAlias
        keyPassword = signingKeyPassword
        providers.environmentVariable("PHYSICSOS_ANDROID_KEYSTORE_TYPE").orNull?.let { storeType = it }
        enableV1Signing = false
        enableV2Signing = true
        enableV3Signing = true
        enableV4Signing = false
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isDebuggable = true
        }
        // Isolated debug field testing may point the app at a local HTTPS bridge on the
        // workstation. On the debug variant with an explicit loopback origin, the local
        // test CA is pinned through app/src/debug/res/xml/network_security_config.xml;
        // release never reads these values and keeps the platform trust store only.
        getByName("release") {
            isDebuggable = false
            isJniDebuggable = false
            isProfileable = false
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = releaseSigning
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        // The Baseline Profile plugin recognizes these names. Both test targets
        // are co-installable with a production APK and never require its key.
        create("benchmarkRelease") {
            initWith(getByName("release"))
            applicationIdSuffix = ".benchmark"
            versionNameSuffix = "-benchmark"
            signingConfig = signingConfigs.getByName("debug")
            isDebuggable = false
            isJniDebuggable = false
            isProfileable = true
            matchingFallbacks += "release"
            buildConfigField("boolean", "IS_BENCHMARK_BUILD", "true")
        }
        create("nonMinifiedRelease") {
            initWith(getByName("release"))
            applicationIdSuffix = ".benchmark"
            versionNameSuffix = "-profile-generation"
            signingConfig = signingConfigs.getByName("debug")
            isDebuggable = false
            isJniDebuggable = false
            isMinifyEnabled = false
            isShrinkResources = false
            isProfileable = true
            matchingFallbacks += "release"
            buildConfigField("boolean", "IS_BENCHMARK_BUILD", "true")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    sourceSets.getByName("main").assets.srcDir(bundledLabAssets)
    sourceSets.getByName("androidTest").assets.srcDir("$projectDir/schemas")
    testOptions {
        unitTests.isReturnDefaultValues = false
        animationsDisabled = true
    }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
        checkDependencies = true
    }
    packaging {
        resources.excludes += setOf("META-INF/INDEX.LIST", "META-INF/DEPENDENCIES")
    }
}

kotlin {
    jvmToolchain(17)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        freeCompilerArgs.add("-Xjspecify-annotations=strict")
    }
}

room {
    // Exported JSON belongs in source control. Room's plugin wires KSP inputs
    // and outputs; don't also set room.schemaLocation by hand.
    schemaDirectory("$projectDir/schemas")
}

baselineProfile {
    // No emulator/device is started by normal APK builds. Generate explicitly
    // on an authorized physical-device executor, then commit the real profile.
    automaticGenerationDuringBuild = false
    saveInSrc = true
    mergeIntoMain = true
}

tasks.named("preBuild") { dependsOn(stageBundledLab) }

val protectedReleaseTasks = setOf(
    "validateSigningRelease", "packageRelease", "packageReleaseBundle",
    "signReleaseBundle", "assembleRelease", "bundleRelease", "installRelease",
)
tasks.configureEach {
    if (name in protectedReleaseTasks) dependsOn(validateReleaseSigning)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.bundles.lifecycle)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.sqlite.bundled)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.datastore)
    implementation(platform(libs.okhttp.bom))
    implementation(libs.okhttp.core)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.markwon.core)
    implementation(libs.markwon.inline.parser)
    implementation(libs.markwon.latex)
    implementation(libs.markwon.tables)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.work.runtime)
    implementation(libs.bundles.camera)
    implementation(libs.androidx.profileinstaller)
    coreLibraryDesugaring(libs.desugar.jdk.libs)
    baselineProfile(project(":benchmark"))

    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(platform(libs.okhttp.bom))
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.okhttp.mockwebserver3)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.bundles.androidx.test)
    androidTestImplementation(libs.androidx.test.uiautomator)
    androidTestImplementation(libs.androidx.room.testing)
    androidTestImplementation(libs.androidx.work.testing)
    androidTestImplementation(libs.kotlinx.coroutines.test)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
