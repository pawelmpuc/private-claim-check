# The page calls this object by name through addJavascriptInterface.
-keepclassmembers class io.github.pawelmpuc.privateclaimcheck.AiBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
