(() => {
  const $ = (id) => document.getElementById(id);
  const authScreen = $("authScreen");
  const form = $("authForm");
  const authMessage = $("authMsg");
  const submitButton = $("authSubmit");
  const passwordInput = $("authPassword");
  let registerMode = false;
  let client = null;

  const setMessage = (text, success = false) => {
    authMessage.textContent = text;
    authMessage.classList.toggle("is-success", success);
  };

  const showLogin = () => {
    document.body.classList.add("auth-locked");
    authScreen.hidden = false;
  };

  const setUser = (user) => {
    const email = user?.email || "";
    if (!email) {
      showLogin();
      return;
    }
    document.body.classList.remove("auth-locked");
    authScreen.hidden = true;
    $("profileEmail").textContent = email;
    $("profileName").textContent = (email.split("@")[0] || "Pengguna")
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    $("profileAvatar").textContent = (email[0] || "P").toUpperCase();
  };

  const friendlyError = (message = "") => {
    const text = message.toLowerCase();
    if (text.includes("invalid login credentials")) return "Email atau kata sandi salah.";
    if (text.includes("email not confirmed")) return "Verifikasi email terlebih dahulu melalui tautan di inbox.";
    if (text.includes("user already registered")) return "Email sudah terdaftar. Silakan masuk.";
    if (text.includes("signup is disabled")) return "Pendaftaran akun sedang dinonaktifkan di Supabase.";
    if (text.includes("password")) return "Kata sandi minimal 6 karakter.";
    if (text.includes("email")) return "Periksa alamat email yang dimasukkan.";
    return message || "Tidak dapat menghubungi layanan login. Coba lagi.";
  };

  const setBusy = (busy) => {
    submitButton.disabled = busy;
    submitButton.textContent = busy ? "Memproses…" : (registerMode ? "Daftar Akun →" : "Masuk →");
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
    setBusy(false);
    setMessage("");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client) {
      setMessage("Layanan login belum siap. Periksa koneksi internet dan pengaturan Supabase.");
      return;
    }

    const email = $("authEmail").value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || password.length < 6) {
      setMessage("Masukkan email yang valid dan kata sandi minimal 6 karakter.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      if (registerMode) {
        const redirectTo = new URL("./", window.location.href).href;
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo }
        });
        if (error) throw error;
        if (data.session?.user) {
          setUser(data.session.user);
        } else {
          setMessage("Pendaftaran berhasil. Buka email Anda dan klik tautan verifikasi untuk mengaktifkan akun.", true);
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setUser(data.user);
      }
    } catch (error) {
      setMessage(friendlyError(error?.message));
    } finally {
      setBusy(false);
    }
  });

  $("authGoogle").addEventListener("click", () => {
    setMessage("Login Google belum diaktifkan. Silakan masuk menggunakan email.");
  });

  $("editProfileButton").addEventListener("click", async () => {
    const { data } = await client.auth.getUser();
    window.alert("Profil pengguna\nEmail: " + (data.user?.email || ""));
  });

  $("privacyInfoButton").addEventListener("click", () => {
    window.alert("Privasi & keamanan\nFoto produk yang dipilih dapat dikirim ke layanan AI untuk diproses. Hindari mengunggah foto sensitif dan periksa hasil sebelum dipublikasikan.");
  });

  $("aboutInfoButton").addEventListener("click", () => {
    window.alert("CEO Shopee\nAI Foto Produk & Video\nVersi 1.0.0 (1)");
  });

  $("logoutButton").addEventListener("click", async () => {
    if (!client) return;
    const button = $("logoutButton");
    button.disabled = true;
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      const dialog = $("settingsDialog");
      if (dialog?.open) dialog.close();
      passwordInput.value = "";
      setMessage("");
      showLogin();
    } catch (error) {
      window.alert(friendlyError(error?.message));
    } finally {
      button.disabled = false;
    }
  });

  const config = window.CEO_SUPABASE_CONFIG;
  if (!window.supabase?.createClient || !config?.url || !config?.publishableKey) {
    showLogin();
    setMessage("Konfigurasi Supabase belum tersedia.");
    return;
  }

  client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  client.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    if (data.session?.user) setUser(data.session.user);
    else showLogin();
  }).catch(() => {
    showLogin();
    setMessage("Tidak dapat memeriksa sesi. Periksa koneksi internet lalu coba lagi.");
  });

  client.auth.onAuthStateChange((event, session) => {
    if (session?.user) setUser(session.user);
    else if (event === "SIGNED_OUT") showLogin();
  });
})();
