# Libraries supply their own consumer rules. Avoid blanket keeps that would
# hide release-only errors and invalidate the release-like benchmarks.
-keepattributes SourceFile,LineNumberTable,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# WorkManager persists fully qualified worker class names in its database.
# Keep only the reflective worker constructors, not the entire application.
-keep,allowoptimization class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# Serialization-generated code is statically referenced. Named companions
# need their serializer lookup retained if a DTO opts into one later.
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <1>$<2> {
    kotlinx.serialization.KSerializer serializer(...);
}

# Origin-restricted AndroidX WebMessageListener is used instead of a generic
# JavascriptInterface. No WebView-wide or application-wide keep is required.
