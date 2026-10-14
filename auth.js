(() => {
  const $ = (id) => document.getElementById(id);
  const authScreen = $("authScreen");
  const form = $("authForm");
  const message = $("authMsg");
  const submitButton = $("authSubmit");
  const passwordInput = $("authPassword");
  const preferenceKey = "ceoShopeeAuthProvider.v1";
  let registerMode = false;
  let transitioning = false;
  let initialized = false;
  let activeProvider = "";
  let activeIdentity = "";
  let supabaseUser = null;
  let supabaseClient;

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
    window.CEO_SYNC_ADAPTER = activeProvider === "supabase" ? {
      provider: "supabase",
      async load() {
        const { data: userData, error: userError } = await supabaseClient.auth.getUser();
        if (userError) throw userError;
        const user = userData.user;
        if (!user) return null;
        const { data, error } = await supabaseClient
          .from("ceo_saved_results")
          .select("results,updated_at")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;
        return data ? { version: 1, results: Array.isArray(data.results) ? data.results : [], updatedAt: data.updated_at } : null;
      },
      async save(state) {
        const { data: userData, error: userError } = await supabaseClient.auth.getUser();
        if (userError) throw userError;
        const user = userData.user;
        if (!user) return false;
        const { error } = await supabaseClient.from("ceo_saved_results").upsert({
          user_id: user.id,
          results: Array.isArray(state?.results) ? state.results : [],
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (error) throw error;
        return true;
      }
    } : null;
  };

  const showLogin = () => {
    document.body.classList.add("auth-locked");
    authScreen.hidden = false;
    activeProvider = "";
    window.CEO_SYNC_ADAPTER = null;
    emitIdentity("");
  };

  const showUser = (user) => {
    if (!user) return showLogin();
    activeProvider = "supabase";
    installSyncAdapter();
    try { localStorage.setItem(preferenceKey, "supabase"); } catch (_) {}
    emitIdentity(`supabase:${user.id}`);
    document.body.classList.remove("auth-locked");
    authScreen.hidden = true;
    const email = String(user.email || "").trim().toLowerCase() || "Pengguna";
    const displayName = email.includes("@") ? email.split("@")[0] : email;
    $("#profileEmail").textContent = email;
    $("#profileName").textContent = displayName.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    $("#profileAvatar").textContent = (displayName[0] || "P").toUpperCase();
    window.CEO_AUTH_EMAIL = email;
  };

  const supabaseError = (error) => {
    const text = (error?.message || "").toLowerCase();
    if (text.includes("invalid login credentials")) return "Email atau kata sandi salah.";
    if (text.includes("email not confirmed")) return "Email belum dikonfirmasi. Periksa inbox.";
    if (text.includes("user already registered")) return "Email sudah terdaftar. Silakan masuk.";
    if (text.includes("signup is disabled")) return "Pendaftaran akun sedang dinonaktifkan.";
    if (text.includes("password")) return "Kata sandi minimal 6 karakter.";
    if (text.includes("email")) return "Periksa alamat email yang dimasukkan.";
    return error?.message || "Login gagal. Coba lagi.";
  };

  const chooseInitialIdentity = async () => {
    if (supabaseUser) return showUser(supabaseUser);
    try { localStorage.removeItem(preferenceKey); } catch (_) {}
    showLogin();
  };

  const onProviderChange = (user) => {
    if (transitioning || !initialized) return;
    if (user) showUser(user);
    else if (activeProvider === "supabase") showLogin();
  };

  $("authSwitch").addEventListener("click", () => {
    registerMode = !registerMode;
    $("authTitle").textContent = registerMode ? "Buat Akun" : "Masuk dengan Email";
    $("authIntro").textContent = registerMode ? "Daftar dengan email untuk mulai menggunakan CEO Shopee." : "Masuk dengan email untuk menggunakan aplikasi CEO Shopee.";
    $("authSwitchText").textContent = registerMode ? "Sudah punya akun?" : "Belum punya akun?";
    $("authSwitch").textContent = registerMode ? "Masuk sekarang" : "Daftar sekarang";
    passwordInput.autocomplete = registerMode ? "new-password" : "current-password";
    submitButton.disabled = false;
    submitButton.textContent = registerMode ? "Daftar Akun →" : "Masuk →";
    setMessage("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabaseClient) return setMessage("Login email belum siap. Periksa koneksi internet.");
    const email = $("authEmail").value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || password.length < 6) return setMessage("Masukkan email yang valid dan kata sandi minimal 6 karakter.");
    submitButton.disabled = true;
    submitButton.textContent = "Memproses…";
    setMessage("");
    transitioning = true;
    try {
      if (registerMode) {
        const redirectTo = new URL("./", window.location.href).href;
        const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        if (data.session?.user) showUser(data.session.user);
        else setMessage("Pendaftaran berhasil. Konfirmasi email jika diminta, lalu masuk.", true);
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showUser(data.user);
      }
    } catch (error) {
      setMessage(supabaseError(error));
    } finally {
      transitioning = false;
      submitButton.disabled = false;
      submitButton.textContent = registerMode ? "Daftar Akun →" : "Masuk →";
    }
  });

  $("editProfileButton").addEventListener("click", async () => {
    const { data } = await supabaseClient.auth.getUser();
    window.alert("Profil pengguna\nEmail: " + (data.user?.email || "") + "\nMasuk dengan: Email");
  });
  $("privacyInfoButton").addEventListener("click", () => window.alert("Privasi & keamanan\nFoto produk yang dipilih dapat dikirim ke layanan AI untuk diproses. Hindari mengunggah foto sensitif dan periksa hasil sebelum dipublikasikan."));
  $("aboutInfoButton").addEventListener("click", () => window.alert("CEO Shopee\nAI Foto Produk & Video\nVersi 1.0.0 (1)"));

  $("logoutButton").addEventListener("click", async () => {
    const button = $("logoutButton");
    button.disabled = true;
    transitioning = true;
    try {
      if (activeProvider === "supabase" && supabaseClient) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
      }
      supabaseUser = null;
      activeProvider = "";
      try { localStorage.removeItem(preferenceKey); } catch (_) {}
      const dialog = $("settingsDialog");
      if (dialog?.open) dialog.close();
      passwordInput.value = "";
      showLogin();
    } catch (error) {
      window.alert(error.message || "Tidak dapat mengeluarkan akun. Coba lagi.");
    } finally {
      transitioning = false;
      button.disabled = false;
    }
  });

  const supabaseConfig = window.CEO_SUPABASE_CONFIG;
  if (!window.supabase?.createClient || !supabaseConfig?.url || !supabaseConfig?.publishableKey) {
    showLogin();
    setMessage("Konfigurasi login email belum tersedia.");
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch (_) {
    showLogin();
    setMessage("Layanan login email gagal dimulai. Muat ulang aplikasi dan coba lagi.");
    return;
  }
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    supabaseUser = session?.user || null;
    onProviderChange(supabaseUser);
  });
  supabaseClient.auth.getSession().then(async ({ data, error }) => {
    if (error) throw error;
    supabaseUser = data.session?.user || null;
    initialized = true;
    await chooseInitialIdentity();
  }).catch(() => {
    initialized = true;
    showLogin();
    setMessage("Login email belum siap. coba lagi.");
  });
})();
