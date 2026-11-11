import org.gradle.api.artifacts.dsl.LockMode

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.test) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.room) apply false
    alias(libs.plugins.baselineprofile) apply false
}

subprojects {
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            val version = requested.version.orEmpty()
            if (version.contains('+') || version.startsWith("latest.") ||
                version.contains("SNAPSHOT", ignoreCase = true) || version.startsWith('[') || version.startsWith('(')
            ) {
                throw GradleException("Use a fixed dependency version: $requested")
            }
        }
    }
    dependencyLocking {
        lockAllConfigurations()
        // Generate locks locally with --write-locks. Gradle does not allow
        // failOnDynamicVersions/failOnChangingVersions together with locking.
        lockMode.set(LockMode.DEFAULT)
    }
}

tasks.wrapper {
    gradleVersion = "8.13"
    distributionType = Wrapper.DistributionType.BIN
    distributionSha256Sum = "20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78"
    networkTimeout = 120_000
    validateDistributionUrl = true
}
