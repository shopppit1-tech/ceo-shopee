import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut as firebaseSignOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const authScreen = $("authScreen");
  const form = $("authForm");
  const message = $("authMsg");
  const submitButton = $("authSubmit");
  const googleButton = $("authGoogle");
  const passwordInput = $("authPassword");
  const preferenceKey = "ceoShopeeAuthProvider.v1";
  let registerMode = false;
  let transitioning = false;
  let initialized = false;
  let activeProvider = "";
  let activeIdentity = "";
  let firebaseUser = null;
  let supabaseUser = null;
  let supabaseClient;
  let firebaseAuth;
  let googleProvider;

  const setMessage = (text, success = false) => {
    message.textContent = text;
    message.classList.toggle("is-success", success);
  };

  const emitIdentity = (identity) => {
    if (activeIdentity === identity) return;
    activeIdentity = identity;
    window.CEO_AUTH_USER_ID = identity || null;
    window.CEO_AUTH_PROVIDER = identity ? activeProvider : null;
    window.dispatchEvent(new CustomEvent("ceo-auth-user-changed", {
      detail: { userId: identity || null, provider: identity ? activeProvider : null }
    }));
  };

  const installSyncAdapter = () => {
    window.CEO_SYNC_ADAPTER = {
      provider: activeProvider,
      async load() {
        if (activeProvider !== "supabase" || !supabaseClient) return null;
        const { data, error } = await supabaseClient.auth.getUser();
        if (error) throw error;
        return data.user?.user_metadata?.ceoShopeeSync || null;
      },
      async save(state) {
        if (activeProvider !== "supabase" || !supabaseClient) return false;
        const { data, error } = await supabaseClient.auth.getUser();
        if (error) throw error;
        const metadata = { ...(data.user?.user_metadata || {}), ceoShopeeSync: state };
        const result = await supabaseClient.auth.updateUser({ data: metadata });
        if (result.error) throw result.error;
        return true;
      }
    };
  };

  const showLogin = () => {
    document.body.classList.add("auth-locked");
    authScreen.hidden = false;
    activeProvider = "";
    window.CEO_SYNC_ADAPTER = null;
    emitIdentity("");
  };

  const showUser = (user, provider) => {
    if (!user) return showLogin();
    const identity = provider === "firebase" ? `firebase:${user.uid}` : `supabase:${user.id}`;
    activeProvider = provider;
    installSyncAdapter();
    try { localStorage.setItem(preferenceKey, provider); } catch (_) {}
    emitIdentity(identity);
    installSyncAdapter();
    document.body.classList.remove("auth-locked");
    authScreen.hidden = true;

    const email = user.email || "Akun Google";
    const displayName = provider === "firebase"
      ? (user.displayName || email.split("@")[0] || "Pengguna")
      : (email.split("@")[0] || "Pengguna");
    $("profileEmail").textContent = email;
    $("profileName").textContent = displayName.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    $("profileAvatar").textContent = (displayName[0] || "P").toUpperCase();
  };

  const supabaseError = (error) => {
    const text = (error?.message || "").toLowerCase();
    if (text.includes("invalid login credentials")) return "Email atau kata sandi salah.";
    if (text.includes("email not confirmed")) return "Email belum dikonfirmasi. Periksa inbox Anda.";
    if (text.includes("user already registered")) return "Email sudah terdaftar. Silakan masuk.";
    if (text.includes("signup is disabled")) return "Pendaftaran akun sedang dinonaktifkan.";
    if (text.includes("password")) return "Kata sandi minimal 6 karakter.";
    if (text.includes("email")) return "Periksa alamat email yang dimasukkan.";
    return error?.message || "Tidak dapat menghubungi layanan login. Coba lagi.";
  };

  const firebaseError = (error) => {
    const messages = {
      "auth/unauthorized-domain": "Domain situs belum diizinkan di Firebase Authentication.",
      "auth/popup-closed-by-user": "Proses login Google dibatalkan.",
      "auth/network-request-failed": "Koneksi internet bermasalah. Coba lagi.",
      "auth/operation-not-allowed": "Login Google belum diaktifkan pada Firebase Authentication.",
      "auth/invalid-api-key": "API key Firebase tidak valid.",
      "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti."
    };
    return messages[error?.code] || `Login Google gagal: ${error?.message || "Terjadi kesalahan."}`;
  };

  const otherSessionCleanup = async (provider) => {
    if (provider === "firebase" && supabaseUser) {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      supabaseUser = null;
    } else if (provider === "supabase" && firebaseAuth.currentUser) {
      await firebaseSignOut(firebaseAuth);
      firebaseUser = null;
    }
  };

  const chooseInitialIdentity = async (redirectUser = null) => {
    const preferred = (() => { try { return localStorage.getItem(preferenceKey) || ""; } catch (_) { return ""; } })();
    let provider = "";
    let user = null;
    if (preferred === "firebase" && (redirectUser || firebaseUser)) {
      provider = "firebase"; user = redirectUser || firebaseUser;
    } else if (preferred === "supabase" && supabaseUser) {
      provider = "supabase"; user = supabaseUser;
    } else if (redirectUser || firebaseUser) {
      provider = "firebase"; user = redirectUser || firebaseUser;
    } else if (supabaseUser) {
      provider = "supabase"; user = supabaseUser;
    }

    if (!user) {
      try { localStorage.removeItem(preferenceKey); } catch (_) {}
      showLogin();
      return;
    }
    showUser(user, provider);
    transitioning = true;
    try { await otherSessionCleanup(provider); } catch (_) {}
    transitioning = false;
  };

  const onProviderChange = (provider, user) => {
    if (transitioning || !initialized) return;
    if (user) {
      if (!activeProvider || activeProvider === provider) showUser(user, provider);
      return;
    }
    if (activeProvider === provider) {
      const alternativeProvider = provider === "firebase" ? "supabase" : "firebase";
      const alternativeUser = alternativeProvider === "firebase" ? firebaseUser : supabaseUser;
      if (alternativeUser) showUser(alternativeUser, alternativeProvider);
      else showLogin();
    }
  };

  $("authSwitch").addEventListener("click", () => {
    registerMode = !registerMode;
    $("authTitle").textContent = registerMode ? "Buat Akun" : "Masuk dengan Email";
    $("authIntro").textContent = registerMode
      ? "Daftar dengan email untuk mulai menggunakan CEO Shopee."
      : "Masuk dengan email untuk menggunakan aplikasi CEO Shopee.";
    $("authSwitchText").textContent = registerMode ? "Sudah punya akun?" : "Belum punya akun?";
    $("authSwitch").textContent = registerMode ? "Masuk sekarang" : "Daftar sekarang";
    passwordInput.autocomplete = registerMode ? "new-password" : "current-password";
    submitButton.disabled = false;
    submitButton.textContent = registerMode ? "Daftar Akun →" : "Masuk →";
    setMessage("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabaseClient) {
      setMessage("Login email Supabase belum siap. Periksa koneksi internet.");
      return;
    }
    const email = $("authEmail").value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || password.length < 6) {
      setMessage("Masukkan email yang valid dan kata sandi minimal 6 karakter.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Memproses…";
    setMessage("");
    transitioning = true;
    try {
      if (registerMode) {
        const redirectTo = new URL("./", window.location.href).href;
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo }
        });
        if (error) throw error;
        if (data.session?.user) {
          supabaseUser = data.session.user;
          await otherSessionCleanup("supabase");
          showUser(supabaseUser, "supabase");
        } else {
          setMessage("Pendaftaran berhasil. Ikuti instruksi konfirmasi email jika diminta.", true);
        }
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        supabaseUser = data.user;
        await otherSessionCleanup("supabase");
        showUser(supabaseUser, "supabase");
      }
    } catch (error) {
      setMessage(supabaseError(error));
    } finally {
      transitioning = false;
      submitButton.disabled = false;
      submitButton.textContent = registerMode ? "Daftar Akun →" : "Masuk →";
    }
  });

  googleButton.addEventListener("click", async () => {
    if (!firebaseAuth || !googleProvider) {
      setMessage("Login Google Firebase belum siap. Periksa konfigurasi Firebase.");
      return;
    }
    googleButton.disabled = true;
    googleButton.textContent = "Mengalihkan ke Google…";
    setMessage("");
    try {
      try { localStorage.setItem(preferenceKey, "firebase"); } catch (_) {}
      await signInWithRedirect(firebaseAuth, googleProvider);
    } catch (error) {
      try { localStorage.removeItem(preferenceKey); } catch (_) {}
      setMessage(firebaseError(error));
      googleButton.disabled = false;
      googleButton.textContent = "🌐  Masuk dengan Google";
    }
  });

  $("editProfileButton").addEventListener("click", async () => {
    if (activeProvider === "firebase" && firebaseAuth.currentUser) {
      const user = firebaseAuth.currentUser;
      window.alert(`Profil pengguna\nNama: ${user.displayName || "Pengguna"}\nEmail: ${user.email || "-"}\nMasuk dengan: Google (Firebase)`);
    } else {
      const { data } = await supabaseClient.auth.getUser();
      window.alert("Profil pengguna\nEmail: " + (data.user?.email || "") + "\nMasuk dengan: Email (Supabase)");
    }
  });

  $("privacyInfoButton").addEventListener("click", () => window.alert(
    "Privasi & keamanan\nFoto produk yang dipilih dapat dikirim ke layanan AI untuk diproses. Hindari mengunggah foto sensitif dan periksa hasil sebelum dipublikasikan."
  ));
  $("aboutInfoButton").addEventListener("click", () => window.alert("CEO Shopee\nAI Foto Produk & Video\nVersi 1.0.0 (1)"));

  $("logoutButton").addEventListener("click", async () => {
    const button = $("logoutButton");
    button.disabled = true;
    transitioning = true;
    try {
      const results = await Promise.allSettled([
        supabaseClient.auth.signOut(),
        firebaseAuth.currentUser ? firebaseSignOut(firebaseAuth) : Promise.resolve()
      ]);
      const supabaseFailure = results[0].status === "rejected" || results[0].value?.error;
      const firebaseFailure = results[1].status === "rejected";
      if (supabaseFailure || firebaseFailure) throw new Error("Tidak dapat mengeluarkan akun. Coba lagi.");
      supabaseUser = null;
      firebaseUser = null;
      activeProvider = "";
      try { localStorage.removeItem(preferenceKey); } catch (_) {}
      const dialog = $("settingsDialog");
      if (dialog?.open) dialog.close();
      passwordInput.value = "";
      setMessage("");
      showLogin();
    } catch (error) {
      window.alert(error.message || "Tidak dapat mengeluarkan akun. Coba lagi.");
    } finally {
      transitioning = false;
      button.disabled = false;
    }
  });

  const supabaseConfig = window.CEO_SUPABASE_CONFIG;
  const firebaseConfig = window.CEO_FIREBASE_CONFIG;
  if (!window.supabase?.createClient || !supabaseConfig?.url || !supabaseConfig?.publishableKey) {
    showLogin();
    setMessage("Konfigurasi login email Supabase belum tersedia.");
    return;
  }
  if (!firebaseConfig?.apiKey || !firebaseConfig?.projectId || !firebaseConfig?.authDomain) {
    showLogin();
    setMessage("Konfigurasi login Google Firebase belum tersedia.");
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });
    window.CEO_SYNC_ADAPTER = null;
  } catch (error) {
    showLogin();
    setMessage("Layanan login gagal dimulai. Muat ulang aplikasi dan coba lagi.");
    return;
  }

  Promise.resolve(setPersistence(firebaseAuth, browserLocalPersistence)).then(async () => {
    let resolveInitialFirebase;
    const initialFirebaseState = new Promise((resolve) => { resolveInitialFirebase = resolve; });
    let firstFirebaseState = true;
    onAuthStateChanged(firebaseAuth, (user) => {
      firebaseUser = user;
      if (firstFirebaseState) {
        firstFirebaseState = false;
        resolveInitialFirebase(user);
      } else onProviderChange("firebase", user);
    }, () => {
      if (firstFirebaseState) {
        firstFirebaseState = false;
        resolveInitialFirebase(null);
      }
    });

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      supabaseUser = session?.user || null;
      onProviderChange("supabase", supabaseUser);
    });

    let redirectUser = null;
    const redirectResultPromise = getRedirectResult(firebaseAuth).then((result) => {
      redirectUser = result?.user || null;
    }).catch((error) => {
      setMessage(firebaseError(error));
    });

    const [{ data, error }] = await Promise.all([
      supabaseClient.auth.getSession(),
      initialFirebaseState,
      redirectResultPromise
    ]);
    if (error) throw error;
    supabaseUser = data.session?.user || supabaseUser;
    initialized = true;
    await chooseInitialIdentity(redirectUser);
  }).catch(() => {
    initialized = true;
    showLogin();
    setMessage("Tidak dapat memeriksa sesi akun. Periksa koneksi internet lalu coba lagi.");
  });
})();
