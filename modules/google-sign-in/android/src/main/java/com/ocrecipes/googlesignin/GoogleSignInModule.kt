package com.ocrecipes.googlesignin

import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SignInOptions : Record {
  @Field val webClientId: String = ""
  @Field val iosClientId: String? = null
  @Field val nonce: String = ""
}

class GoogleSignInModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OCRGoogleSignIn")

    AsyncFunction("signIn") Coroutine { options: SignInOptions ->
      signIn(options)
    }
  }

  /** null = the person cancelled. */
  private suspend fun signIn(options: SignInOptions): Map<String, Any?>? {
    if (options.webClientId.isEmpty()) {
      throw CodedException("NOT_CONFIGURED", "Google web client ID missing", null)
    }
    val activity = appContext.currentActivity
      ?: throw CodedException("FAILED", "No current activity", null)
    val manager = CredentialManager.create(activity)
    val option = GetSignInWithGoogleOption.Builder(options.webClientId)
      .setNonce(options.nonce)
      .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

    val response = try {
      manager.getCredential(activity, request)
    } catch (e: GetCredentialCancellationException) {
      return null
    } catch (e: NoCredentialException) {
      throw CodedException("NO_ACCOUNT", e.message, e)
    } catch (e: GetCredentialProviderConfigurationException) {
      throw CodedException("PLAY_SERVICES", e.message, e)
    } catch (e: GetCredentialUnsupportedException) {
      throw CodedException("PLAY_SERVICES", e.message, e)
    }

    val credential = response.credential
    if (credential !is CustomCredential ||
      credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
    ) {
      throw CodedException("FAILED", "Unexpected credential type", null)
    }
    val google = GoogleIdTokenCredential.createFrom(credential.data)
    // Our session is our own JWT; clear Google's so the next tap shows the picker.
    runCatching { manager.clearCredentialState(ClearCredentialStateRequest()) }
    return mapOf("idToken" to google.idToken, "email" to google.id)
  }
}
