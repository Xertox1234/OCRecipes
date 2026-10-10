import ExpoModulesCore
import GoogleSignIn

/// Hands Google's sign-in redirect back to the SDK. AppDelegate inherits
/// ExpoAppDelegate and calls super, which fans out to subscribers.
public class GoogleSignInAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return GIDSignIn.sharedInstance.handle(url)
  }
}
