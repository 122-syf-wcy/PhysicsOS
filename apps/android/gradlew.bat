@rem Launch the official, checksum-verified Gradle 8.13 wrapper JAR.
@echo off
setlocal
set "APP_HOME=%~dp0"
set "WRAPPER_JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar"
if not exist "%WRAPPER_JAR%" (
  >&2 echo The checked-in Gradle wrapper JAR is missing.
  >&2 echo Restore gradle/wrapper/gradle-wrapper.jar from Git; do not download an unverified replacement.
  exit /b 78
)
set "WRAPPER_SHA="
for /f "skip=1 tokens=*" %%H in ('certutil -hashfile "%WRAPPER_JAR%" SHA256 2^>nul') do (
  if not defined WRAPPER_SHA set "WRAPPER_SHA=%%H"
)
set "WRAPPER_SHA=%WRAPPER_SHA: =%"
if /i not "%WRAPPER_SHA%"=="81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f" (
  >&2 echo Gradle wrapper JAR checksum mismatch or SHA-256 verifier unavailable.
  exit /b 78
)
if defined JAVA_HOME (
  set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
) else (
  set "JAVA_EXE=java.exe"
)
"%JAVA_EXE%" -Xms64m -Xmx64m -Dorg.gradle.appname=gradlew -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
