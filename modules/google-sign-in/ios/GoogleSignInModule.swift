import ExpoModulesCore
import GoogleSignIn

struct SignInOptions: Record {
  @Field var webClientId: String = ""
  @Field var iosClientId: String? = nil
  @Field var nonce: String = ""
}

private func coded(_ code: String, _ description: String) -> Exception {
  Exception(name: "GoogleSignIn", description: description, code: code)
}

private let clientIdSuffix = ".apps.googleusercontent.com"

/// GoogleSignIn raises an uncatchable NSException (the app closes) when the
/// reversed client ID is missing from CFBundleURLTypes — check first.
private func hasUrlScheme(for clientId: String) -> Bool {
  guard clientId.hasSuffix(clientIdSuffix) else { return false }
  let scheme = "com.googleusercontent.apps." + clientId.dropLast(clientIdSuffix.count)
  let types = Bundle.main.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] ?? []
  return types.contains { ($0["CFBundleURLSchemes"] as? [String] ?? []).contains(scheme) }
}

public final class GoogleSignInModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OCRGoogleSignIn")

    AsyncFunction("signIn") { (options: SignInOptions, promise: Promise) in
      guard let iosClientId = options.iosClientId, !iosClientId.isEmpty,
            !options.webClientId.isEmpty,
            hasUrlScheme(for: iosClientId) else {
        promise.reject(coded("NOT_CONFIGURED", "Google sign-in is not configured in this build"))
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject(coded("FAILED", "No view controller to present from"))
        return
      }
      GIDSignIn.sharedInstance.configuration = GIDConfiguration(
        clientID: iosClientId,
        serverClientID: options.webClientId
      )
      GIDSignIn.sharedInstance.signIn(
        withPresenting: presenter,
        hint: nil,
        additionalScopes: nil,
        nonce: options.nonce
      ) { result, error in
        if let error = error as NSError? {
          if error.code == GIDSignInError.canceled.rawValue {
            promise.resolve(nil)
          } else {
            promise.reject(coded("FAILED", error.localizedDescription))
          }
          return
        }
        guard let user = result?.user, let idToken = user.idToken?.tokenString else {
          promise.reject(coded("FAILED", "Google returned no ID token"))
          return
        }
        let email = user.profile?.email
        // Our session is our own JWT; forget Google's so the next tap shows
        // the account picker.
        GIDSignIn.sharedInstance.signOut()
        promise.resolve(["idToken": idToken, "email": email as Any])
      }
    }.runOnQueue(.main)
  }
}
