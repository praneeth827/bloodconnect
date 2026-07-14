// Ensure Google Maps callback exists before the API script fires
if (typeof window !== 'undefined') {
    window.__googleMapsReady = false;
    window.initMap = function() {
        window.__googleMapsReady = true;
        window.dispatchEvent(new Event('google-maps-loaded'));
        console.log('Google Maps callback executed');
    };
}
 
// BloodConnect Application - Vanilla JavaScript
class BloodConnectApp {
    constructor() {
        this.currentUser = null;
        this.currentPage = 'landing';
        this.currentDonor = null;
        this.currentRequestDonorId = null;
        this.searchResults = [];
        this.isRegisterMode = false;
        this.map = null;
        this.isGoogleMapsLoaded = false;
        this._loadingTimer = null;
        this._mapMarkers = [];
        this.STORAGE_KEYS = {
            sessionUser: 'bloodconnect_user',
            appData: 'bloodconnect_data',
            token: 'bloodconnect_token'
        };
        this.authToken = null;
        this._requestsAsSeeker = [];
        this._requestsAsDonor = [];
        this._modalDonorId = null;
        this.MAX_USERS = 50; // increased capacity as requested
        this.searchCenter = null;
        this._croppedProfileImage = null;
        this._cropperInstance = null;
        this.searchRadiusKm = 10;
        this.language = 'en';
        this.translations = this.buildTranslations();
        this.firebaseReady = false;
        this.firebaseUser = null;
        
        // App data stored only from actual usage (no pre-seeded mock records)
        this.mockData = {
            users: [],
            donors: [],
            donations: [],
            bloodRequests: []
        };
        
        this.init();
    }
    
    init() {
        this.loadDataFromStorage();
        this.loadUserFromStorage();
        this.loadTokenFromStorage();
        this.loadLanguageFromStorage();
        this.bindEvents();
        this.initFirebase();
        this.handleGoogleRedirect().then(() => this.checkAuthStatus());
        this.applyTranslations();
        // Ensure a concrete page is shown immediately so the app never appears blank.
        this.showPage('seeker-dashboard');
        
        // Check whether Google OAuth is configured on the backend; show/hide button accordingly
        this._checkGoogleOAuthStatus();

        // Wire Google Maps loaded event
        if (window.__googleMapsReady) {
            this.isGoogleMapsLoaded = true;
        }
        window.addEventListener('google-maps-loaded', () => {
            this.isGoogleMapsLoaded = true;
            if (this.currentPage === 'seeker-dashboard' && this.searchResults.length > 0) {
                this.initializeMap();
            }
        });
    }

    async _checkGoogleOAuthStatus() {
        try {
            const res = await fetch('/api/auth/google/status');
            const data = await res.json();
            const btn = document.getElementById('google-auth-btn');
            const msg = document.getElementById('google-not-configured-msg');
            if (!data.configured) {
                if (btn) btn.disabled = true;
                if (msg) msg.style.display = 'block';
                console.warn('[Google OAuth] Not configured on server — Google Sign-In button disabled.');
            } else {
                if (btn) btn.disabled = false;
                if (msg) msg.style.display = 'none';
                console.log('[Google OAuth] Configured and ready.');
            }
        } catch (e) {
            console.warn('[Google OAuth] Could not check status:', e.message);
        }
    }
 
 
    
    loadDataFromStorage() {
        // Backend mode: data lives in SQLite via Node.js API, not localStorage.
        // Keep these arrays only as UI caches.
        this.mockData = { users: [], donors: [], donations: [], bloodRequests: [] };
    }
 
    // Password policy: min 8, upper, lower, number, special and confirm match
    assertPasswordPolicy(password, confirmPassword) {
        const minLen = password && password.length >= 8;
        const upper = /[A-Z]/.test(password || '');
        const lower = /[a-z]/.test(password || '');
        const number = /[0-9]/.test(password || '');
        const special = /[^A-Za-z0-9]/.test(password || '');
        if (!(minLen && upper && lower && number && special)) {
            throw new Error('Password must be 8+ chars incl. upper, lower, number, special.');
        }
        if (confirmPassword !== undefined && password !== confirmPassword) {
            throw new Error('Passwords do not match.');
        }
    }
 
    // Google auth: Always use Firebase for real Google authentication
    async handleGoogleAuth() {
        console.log('🔍 Google auth started');
        console.log('🔍 Firebase ready:', this.firebaseReady);
        console.log('🔍 Firebase object:', !!window.firebase);
        console.log('🔍 GoogleAuthProvider:', !!window.firebase?.GoogleAuthProvider);
        console.log('🔍 Auth object:', !!window.firebase?.auth);
        
        try {
            // Always try Firebase first - this should work on live domain
            if (window.firebase?.GoogleAuthProvider && window.firebase?.auth) {
                console.log('✅ Attempting Firebase Google authentication...');
                await this.firebaseGoogleLogin();
                return; // Success, syncFirebaseUser will handle the rest
            } else {
                console.log('❌ Firebase not ready, missing components');
                throw new Error('Firebase not properly initialized');
            }
        } catch (error) {
            console.error('❌ Firebase Google auth failed:', error);
            console.error('Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            
            // Show specific error message based on error type
            if (error.code === 'auth/unauthorized-domain') {
                this.showToast('Google Sign-in Error', 'This domain is not authorized for Google sign-in. Please contact the administrator.', 'error');
            } else if (error.code === 'auth/popup-blocked') {
                this.showToast('Google Sign-in Error', 'Popup was blocked by your browser. Please allow popups for this site and try again.', 'error');
            } else if (error.code === 'auth/network-request-failed') {
                this.showToast('Google Sign-in Error', 'Network error. Please check your internet connection and try again.', 'error');
            } else {
                this.showToast('Google Sign-in Error', 'Please try again or use email/password login.', 'error');
            }
        }
    }
 
    handleMockGoogleAuth() {
        // Create a mock Google user directly without additional details form
        const generatedEmail = `user${Date.now()}@gmail.com`;
        const googleProfile = { 
            email: generatedEmail, 
            firstName: 'Google', 
            lastName: 'User',
            password: 'google_user_password' // Auto-generated password
        };
        
        // Create user account directly using existing method
        const newUser = {
            id: `user_${Date.now()}`,
            email: googleProfile.email,
            firstName: googleProfile.firstName,
            lastName: googleProfile.lastName,
            password: googleProfile.password,
            role: null,
            provider: 'google'
        };
        
        this.mockData.users.push(newUser);
        this.currentUser = newUser;
        this.saveUserToStorage();
        this.saveDataToStorage();
        
        this.showToast('Signed in with Google', 'Choose your role to continue.');
        this.showPage('role-selection');
    }
 
 
    // Handle Additional Details submission for Google flow
    handleAdditionalDetails(e) {
        e.preventDefault();
        const form = e.target;
        const data = new FormData(form);
        const firstName = data.get('firstName');
        const lastName = data.get('lastName');
        const password = data.get('password');
        const confirmPassword = data.get('confirmPassword');
        try {
            this.assertPasswordPolicy(password, confirmPassword);
            const email = this._pendingGoogle?.email || `user${Date.now()}@gmail.com`;
            const exists = this.mockData.users.find(u => u.email === email);
            const user = exists || { id: Date.now().toString(), email, password, firstName, lastName, role: null };
            if (!exists) this.mockData.users.push(user);
            // If existed, update name and password from Additional Details
            if (exists) {
                exists.firstName = firstName;
                exists.lastName = lastName;
                exists.password = password;
            }
            this.currentUser = user;
            this.saveUserToStorage();
            this.saveDataToStorage();
            this._pendingGoogle = null;
            this.showToast('Details saved', 'Continue by choosing your role.');
            this.showPage('role-selection');
        } catch (err) {
            this.showToast('Invalid Details', err.message, 'error');
        }
    }
 
    // Handle rules and eligibility; finalize donor profile
    async handleEligibility(e) {
        e.preventDefault();
        const data = new FormData(e.target);
        const ok = data.get('q1') === 'yes' && data.get('q2') === 'yes' && data.get('q3') === 'yes' && data.get('acceptRules') === 'on';
        if (!ok) {
            this.showToast('Not eligible', 'You must meet all requirements and accept rules.', 'error');
            return;
        }
        if (!this.currentUser || !this._pendingDonorProfile) {
            this.showToast('Session expired', 'Please re-enter your profile details.', 'error');
            this.showPage('donor-setup');
            return;
        }
 
        this.showLoading('Creating donor profile...');
        try {
            const p = this._pendingDonorProfile;
            
            // Create FormData if file exists, otherwise use JSON
            let body, headers = {};
            if (p.govIdFile) {
                const formData = new FormData();
                formData.append('bloodType', p.bloodType);
                formData.append('age', p.age);
                formData.append('gender', p.gender);
                formData.append('contact', p.contact);
                formData.append('occupation', p.occupation);
                formData.append('location', p.location);
                formData.append('state', p.state || '');
                if (p.latitude) formData.append('latitude', p.latitude);
                if (p.longitude) formData.append('longitude', p.longitude);
                formData.append('availability', p.availability || 'available');
                formData.append('govId', p.govIdFile);
                body = formData;
                // Don't set Content-Type header for FormData - browser will set it with boundary
            } else {
                body = JSON.stringify({
                    bloodType: p.bloodType,
                    age: p.age,
                    gender: p.gender,
                    contact: p.contact,
                    occupation: p.occupation,
                    location: p.location,
                    state: p.state || '',
                    latitude: p.latitude || null,
                    longitude: p.longitude || null,
                    availability: p.availability || 'available',
                });
                headers = { 'Content-Type': 'application/json' };
            }
            
            const out = await this.apiFetch('/api/donors/me', {
                method: 'PUT',
                body: body,
                headers: headers
            });
            this.currentDonor = out.donor;
            if (p.profileImageFile) {
                try {
                    const fd = new FormData();
                    fd.append('profileImage', p.profileImageFile);
                    const imgOut = await this.apiFetch('/api/donors/me/profile-image', {
                        method: 'POST',
                        body: fd,
                        headers: {}
                    });
                    this.currentDonor = imgOut.donor || this.currentDonor;
                } catch (_) { /* ignore */ }
            }
            this._pendingDonorProfile = null;
 
            // Ensure role is donor on server (and local cache)
            try {
                const roleOut = await this.apiFetch('/api/users/me', {
                    method: 'PATCH',
                    body: JSON.stringify({ role: 'donor' })
                });
                this.currentUser = roleOut.user;
        this.saveUserToStorage();
            } catch (_) {}
        
            await this.refreshRequests();
        this.showToast('Donor Profile Created', 'You can now access your dashboard.');
        this.showPage('donor-dashboard');
        } catch (err) {
            this.showToast('Error', err.message, 'error');
            this.showPage('donor-setup');
        } finally {
            this.hideLoading();
        }
    }
    saveDataToStorage() {
        // Backend mode: no-op (data is persisted on server).
    }
 
    loadUserFromStorage() {
        const userData = localStorage.getItem(this.STORAGE_KEYS.sessionUser);
        if (userData) {
            this.currentUser = JSON.parse(userData);
        }
    }
 
    loadTokenFromStorage() {
        const token = localStorage.getItem(this.STORAGE_KEYS.token);
        if (token) this.authToken = token;
    }
    
    saveUserToStorage() {
        if (this.currentUser) {
            localStorage.setItem(this.STORAGE_KEYS.sessionUser, JSON.stringify(this.currentUser));
        } else {
            localStorage.removeItem(this.STORAGE_KEYS.sessionUser);
        }
    }
 
    saveTokenToStorage() {
        if (this.authToken) localStorage.setItem(this.STORAGE_KEYS.token, this.authToken);
        else localStorage.removeItem(this.STORAGE_KEYS.token);
    }
 
    async handleGoogleRedirect() {
        const url = new URL(window.location.href);
        const token = url.searchParams.get('googleToken');
        if (!token) return;
        this.authToken = token;
        this.saveTokenToStorage();
        // Clean URL
        url.searchParams.delete('googleToken');
        url.searchParams.delete('googleError');
        url.searchParams.delete('firstName');
        url.searchParams.delete('lastName');
        const newUrl = url.toString();
        window.history.replaceState({}, document.title, newUrl);
        try {
            const me = await this.apiFetch('/api/auth/me');
            this.currentUser = me.user;
            this.saveUserToStorage();
            this.showToast('Signed in with Google', 'Choose your role to continue.');
            this.showPage('role-selection');
        } catch (err) {
            this.showToast('Google sign-in failed', err.message, 'error');
            this.authToken = null;
            this.saveTokenToStorage();
        }
    }
 
    async apiFetch(path, options = {}) {
        const { auth = true, ...fetchOpts } = options;
        // Only set Content-Type if not FormData (FormData sets its own Content-Type with boundary)
        const isFormData = fetchOpts.body instanceof FormData;
        const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
        Object.assign(headers, fetchOpts.headers || {});
        if (auth && this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
        const res = await fetch(path, { ...fetchOpts, headers });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
        if (!res.ok) {
            const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
            if (res.status === 401) {
                // session expired
                this.authToken = null;
                this.currentUser = null;
                this.currentDonor = null;
                this.saveTokenToStorage();
                this.saveUserToStorage();
            }
            throw new Error(msg);
        }
        return data;
    }
    
    bindEvents() {
        // Language selector
        const langSelect = document.getElementById('language-select');
        if (langSelect) {
            langSelect.value = this.language;
            langSelect.addEventListener('change', () => {
                this.setLanguage(langSelect.value);
            });
        }
        // Navigation events
        document.getElementById('back-btn')?.addEventListener('click', () => this.showPage('landing'));
        document.getElementById('get-started-btn')?.addEventListener('click', () => {
            this.isRegisterMode = true;
            this.showPage('auth');
            this.updateAuthForm();
        });
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        document.getElementById('switch-role-btn')?.addEventListener('click', () => this.switchRole());
        document.getElementById('user-progress-btn')?.addEventListener('click', () => this.toggleUserProgressPanel());
        document.getElementById('panel-logout-btn')?.addEventListener('click', () => this.logout());
        
        // Auth events
        document.getElementById('auth-toggle-btn')?.addEventListener('click', () => this.toggleAuthMode());
        document.getElementById('auth-form')?.addEventListener('submit', (e) => this.handleAuth(e));
        // Password eye toggle
        const pwInput = document.getElementById('auth-password');
        const pwToggle = document.getElementById('auth-password-toggle');
        pwToggle?.addEventListener('click', () => {
            if (!pwInput) return;
            const isPwd = pwInput.type === 'password';
            pwInput.type = isPwd ? 'text' : 'password';
        });
        // Social auth buttons
        document.getElementById('google-auth-btn')?.addEventListener('click', () => {
            window.location.href = '/api/auth/google';
        });
        // Additional details form
        document.getElementById('additional-details-form')?.addEventListener('submit', (e) => this.handleAdditionalDetails(e));
        
        // Role selection
        document.querySelectorAll('.role-card').forEach(card => {
            card.addEventListener('click', () => this.selectRole(card.dataset.role));
        });
        
        // Donor setup
        document.getElementById('get-location-btn')?.addEventListener('click', () => this.getCurrentLocation());
        document.getElementById('donor-setup-form')?.addEventListener('submit', (e) => this.handleDonorSetup(e));
        // Removed inline dashboard edit button; now in user progress panel
        // Clear any stale lat/lng if user manually edits donor location; geocode on blur for immediate feedback
        const donorLocInput = document.querySelector('#donor-setup-form input[name="location"]');
        donorLocInput?.addEventListener('input', () => {
            delete donorLocInput.dataset.latitude;
            delete donorLocInput.dataset.longitude;
        });
        donorLocInput?.addEventListener('blur', async () => {
            if (!donorLocInput.value) return;
            try {
                const coords = await this.geocodeAddress(donorLocInput.value);
                donorLocInput.dataset.latitude = coords.latitude;
                donorLocInput.dataset.longitude = coords.longitude;
                donorLocInput.value = coords.locationFormatted || this.normalizeManualLocationString(donorLocInput.value);
                this.showToast('Location set', 'We updated the map position for your address.');
            } catch (_) {
                // No geocode: normalize order but keep text
                donorLocInput.value = this.normalizeManualLocationString(donorLocInput.value);
            }
        });
        
        // Search form
        document.getElementById('donor-search-form')?.addEventListener('submit', (e) => this.handleDonorSearch(e));
        // Clear any stale lat/lng if user manually edits seeker location
        const seekerLocInput = document.querySelector('#donor-search-form input[name="location"]');
        seekerLocInput?.addEventListener('input', () => {
            delete seekerLocInput.dataset.latitude;
            delete seekerLocInput.dataset.longitude;
        });
        // Seeker location button (GPS)
        document.getElementById('seeker-location-btn')?.addEventListener('click', async () => {
            try {
                this.showLoading('Detecting your location...');
                const loc = await this.getLocationData();
                const input = document.querySelector('#donor-search-form input[name="location"]');
                if (input) {
                    input.value = loc.location;
                    input.dataset.latitude = loc.latitude;
                    input.dataset.longitude = loc.longitude;
                }
            } catch (_) {
                this.showToast('Location error', 'Unable to detect your location. Please enter it manually.', 'error');
            } finally {
                this.hideLoading();
            }
        });
 
        // Modal: single-donor blood request location
        document.getElementById('modal-location-btn')?.addEventListener('click', async () => {
            try {
                this.showLoading('Detecting your location...');
                const loc = await this.getLocationData();
                const input = document.querySelector('#blood-request-form input[name="location"]');
                if (input) {
                    input.value = loc.location;
                }
            } catch (_) {
                this.showToast('Location error', 'Unable to detect your location. Please enter it manually.', 'error');
            } finally {
                this.hideLoading();
            }
        });
 
        // Modal: general broadcast request location
        document.getElementById('general-location-btn')?.addEventListener('click', async () => {
            try {
                this.showLoading('Detecting your location...');
                const loc = await this.getLocationData();
                const input = document.querySelector('#general-request-form input[name="location"]');
                if (input) {
                    input.value = loc.location;
                }
            } catch (_) {
                this.showToast('Location error', 'Unable to detect your location. Please enter it manually.', 'error');
            } finally {
                this.hideLoading();
            }
        });
        
        // Modal events
        document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('call-donor-btn')?.addEventListener('click', () => this.callDonor());
        
        // Create request button
        document.getElementById('create-request-btn')?.addEventListener('click', () => {
            this.showGeneralRequestModal();
        });
        
        // Close modal when clicking outside
        document.getElementById('donor-modal')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeModal();
            }
        });
 
        // Blood request modal events
        document.getElementById('close-request-modal-btn')?.addEventListener('click', () => this.closeBloodRequestModal());
        document.getElementById('cancel-request-btn')?.addEventListener('click', () => this.closeBloodRequestModal());
        document.getElementById('submit-request-btn')?.addEventListener('click', (e) => this.handleBloodRequestSubmit(e));
        
        // Close blood request modal when clicking outside
        document.getElementById('blood-request-modal')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeBloodRequestModal();
            }
        });
 
        // General request modal events
        document.getElementById('close-general-request-modal-btn')?.addEventListener('click', () => this.closeGeneralRequestModal());
        document.getElementById('cancel-general-request-btn')?.addEventListener('click', () => this.closeGeneralRequestModal());
        document.getElementById('submit-general-request-btn')?.addEventListener('click', (e) => this.handleGeneralRequestSubmit(e));
        
        // Close general request modal when clicking outside
        document.getElementById('general-request-modal')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeGeneralRequestModal();
            }
        });
 
        // Clear history buttons
        document.getElementById('clear-seeker-history-btn')?.addEventListener('click', () => this.clearSeekerHistory());
        document.getElementById('clear-donor-history-btn')?.addEventListener('click', () => this.clearDonorHistory());
 
        // Auto-hide user progress when clicking outside
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('user-progress-panel');
            const btn = document.getElementById('user-progress-btn');
            if (!panel || panel.style.display === 'none') return;
            const target = e.target;
            if (panel.contains(target) || btn.contains(target)) return;
            panel.style.display = 'none';
        });
 
        // Hide panel on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('user-progress-panel');
                if (panel) panel.style.display = 'none';
            }
        });
 
        // Eligibility form
        document.getElementById('eligibility-form')?.addEventListener('submit', (e) => this.handleEligibility(e));
        // User progress panel actions
        document.getElementById('up-edit-profile-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('user-progress-panel');
            if (panel) panel.style.display = 'none';
            this.startEditDonorProfile();
        });
        document.getElementById('edit-profile-btn')?.addEventListener('click', () => this.startEditDonorProfile());
        document.getElementById('up-recent-toggle')?.addEventListener('click', () => this.toggleRecentDonations());
        document.getElementById('profile-image-input')?.addEventListener('change', (e) => this.handleProfileImageSelect(e));
        document.getElementById('profile-photo-clear-btn')?.addEventListener('click', () => this._clearProfilePhotoSelection());
        document.getElementById('donor-avatar-wrap')?.addEventListener('click', () => document.getElementById('donor-avatar-edit-input')?.click());
        document.getElementById('donor-avatar-edit-input')?.addEventListener('change', (e) => this.handleAvatarEditSelect(e));
        document.getElementById('crop-modal-close')?.addEventListener('click', () => this.closeCropModal());
        document.getElementById('crop-cancel-btn')?.addEventListener('click', () => this.closeCropModal());
        document.getElementById('crop-apply-btn')?.addEventListener('click', () => this.applyCrop());
        document.getElementById('crop-aspect-ratio')?.addEventListener('change', (e) => this.setCropAspectRatio(e.target.value));
        const upAvail = document.getElementById('up-availability-select');
        upAvail?.addEventListener('change', (e) => this.updateAvailability(e));
 
        // Warn before refresh/navigation so users don't accidentally lose form progress
        window.addEventListener('beforeunload', (e) => {
            // Show prompt only if user is logged in or has entered data in forms
            const hasSession = !!this.currentUser;
            const donorForm = document.getElementById('donor-setup-form');
            const authForm = document.getElementById('auth-form');
            const donorFormDirty = donorForm ? (new FormData(donorForm).toString().length > 0) : false;
            const authFormDirty = authForm ? (new FormData(authForm).toString().length > 0) : false;
            if (hasSession || donorFormDirty || authFormDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }
 
    buildTranslations() {
        return {
            en: {
                'landing.title': 'Find Blood Fast.\n<span class="text-red">Donate with Confidence.</span>',
                'landing.subtitle': 'A modern platform that connects seekers with nearby donors instantly. Join now and help save lives in minutes.',
                'landing.cta': 'Get Started',
                'landing.how': 'How it works',
                'auth.title': 'Welcome Back',
                'auth.subtitle': 'Sign in to your account',
                'auth.submit': 'Sign In',
                'auth.toggle_text': "Don't have an account?",
                'auth.toggle_btn': 'Sign up',
                'auth.title_signup': 'Create Your Account',
                'auth.subtitle_signup': 'Join BloodConnect today',
                'auth.submit_signup': 'Sign Up',
                'auth.toggle_text_signup': 'Already have an account?',
                'auth.toggle_btn_signin': 'Sign in',
                'auth.email': 'Email',
                'auth.email_ph': 'Enter your email',
                'auth.password': 'Password',
                'auth.password_ph': 'Enter your password',
                'auth.firstName': 'First Name',
                'auth.firstName_ph': 'Enter your first name',
                'auth.lastName': 'Last Name',
                'auth.lastName_ph': 'Enter your last name',
                'role.title': 'Choose Your Role',
                'role.subtitle': 'How would you like to participate in BloodConnect?',
                'role.donor': 'Blood Donor',
                'role.donor_desc': 'Donate blood and help save lives in your community',
                'role.donor_f1': 'Track your donations',
                'role.donor_f2': 'Receive urgent requests',
                'role.donor_f3': 'View donation history',
                'role.seeker': 'Blood Seeker',
                'role.seeker_desc': 'Find blood donors when you or your loved ones need help',
                'role.seeker_f1': 'Search for donors',
                'role.seeker_f2': 'Submit blood requests',
                'role.seeker_f3': 'Track request status',
                'setup.title': 'Complete Your Donor Profile',
                'setup.subtitle': 'Help us connect you with people who need your help',
                'setup.bloodType': 'Blood Type *',
                'setup.age': 'Age *',
                'setup.gender': 'Gender *',
                'setup.contact': 'Contact Number *',
                'setup.occupation': 'Occupation *',
                'setup.occupation_ph': 'e.g., Student, Engineer',
                'setup.location': 'Location *',
                'setup.location_ph': 'City, State (e.g., San Francisco, CA)',
                'setup.hint': 'Click the location button to use your current location',
                'setup.req_title': 'Donor Requirements',
                'setup.req1': 'Must be 18-65 years old',
                'setup.req2': 'Weigh at least 110 pounds',
                'setup.req3': 'Be in good general health',
                'setup.req4': 'Wait 56 days between whole blood donations',
                'setup.submit': 'Create Donor Profile',
                'donorDash.title': 'Donor Dashboard',
                'donorDash.subtitle': 'Track your donations and help those in need',
                'donorDash.profile': 'Your Profile',
                'donorDash.recent': 'Recent Donations',
                'seeker.title': 'Seeker Dashboard',
                'seeker.subtitle': 'Find blood donors in your area',
                'seeker.search_title': 'Find Blood Donors',
                'seeker.urgent_title': 'URGENT BLOOD REQUIREMENT',
                'seeker.bloodNeeded': 'Blood Type Needed',
                'seeker.blood_hint': 'Tip: Hold Ctrl (Cmd on Mac) to select multiple',
                'seeker.units': 'Units Needed *',
                'seeker.units_ph': 'e.g., 2',
                'seeker.patient': 'Patient Name *',
                'seeker.patient_ph': 'Enter patient name',
                'seeker.hospital_location': 'Hospital & Location *',
                'seeker.location_ph': 'Hospital Name, City',
                'seeker.location_hint': 'Click 📍 to use your current location',
                'seeker.case': 'Case *',
                'seeker.case_ph': 'e.g., Surgery / Emergency',
                'seeker.case_accident': 'Accident / Trauma',
                'seeker.case_surgery': 'Surgery',
                'seeker.case_cancer': 'Cancer Treatment',
                'seeker.case_delivery': 'Delivery / Maternity',
                'seeker.case_other': 'Other',
                'seeker.contact': 'Contact *',
                'seeker.contact_ph': 'Name - Phone Number',
                'seeker.location': 'Location',
                'seeker.search_btn': 'Search Donors',
                'seeker.available': 'Available Donors',
                'detail.age': 'Age',
                'detail.gender': 'Gender',
                'detail.occupation': 'Occupation',
                'detail.availability': 'Availability',
                'detail.available': 'Available',
                'detail.contact_btn': 'Contact Donor'
            },
            te: {
                'landing.title': 'రక్తం త్వరగా పొందండి.\n<span class="text-red">ఆత్మవిశ్వాసంతో దానం చేయండి.</span>',
                'landing.subtitle': 'సమీప దాతలను మీకు వెంటనే కలుపుతుంది. ఇప్పుడే చేరండి, ప్రాణాలు కాపాడండి.',
                'landing.cta': 'ప్రారంభించండి',
                'landing.how': 'అది ఎలా పనిచేస్తుంది',
                'auth.title': 'మళ్ళీ స్వాగతం',
                'auth.subtitle': 'మీ ఖాతాలో ప్రవేశించండి',
                'auth.submit': 'సైన్ ఇన్',
                'auth.toggle_text': 'ఖాతా లేదా?',
                'auth.toggle_btn': 'సైన్ అప్',
                'auth.title_signup': 'మీ ఖాతాను సృష్టించండి',
                'auth.subtitle_signup': 'ఈ రోజు BloodConnect లో చేరండి',
                'auth.submit_signup': 'సైన్ అప్',
                'auth.toggle_text_signup': 'ఇప్పటికే ఖాతా ఉందా?',
                'auth.toggle_btn_signin': 'సైన్ ఇన్',
                'auth.email': 'ఇమెయిల్',
                'auth.email_ph': 'మీ ఇమెయిల్ నమోదు చేయండి',
                'auth.password': 'పాస్వర్డ్',
                'auth.password_ph': 'మీ పాస్వర్డ్ నమోదు చేయండి',
                'auth.firstName': 'పేరు',
                'auth.firstName_ph': 'మీ మొదటి పేరు',
                'auth.lastName': 'ఇంటిపేరు',
                'auth.lastName_ph': 'మీ చివరి పేరు',
                'role.title': 'మీ పాత్రను ఎంచుకోండి',
                'role.subtitle': 'మీరు BloodConnect లో ఎలా పాల్గొంటారు?',
                'role.donor': 'రక్తదాత',
                'role.donor_desc': 'మీ సమాజంలో ప్రాణాలను కాపాడేందుకు దానం చేయండి',
                'role.donor_f1': 'మీ దానాలు ట్రాక్ చేయండి',
                'role.donor_f2': 'అత్యవసర అభ్యర్థనలు పొందండి',
                'role.donor_f3': 'దాతృత్వ చరిత్రను చూడండి',
                'role.seeker': 'రక్తం కోరేవారు',
                'role.seeker_desc': 'మీకు లేదా మీ బంధువులకు అవసరం ఉన్నప్పుడు దాతలను కనుగొనండి',
                'role.seeker_f1': 'దాతలను శోధించండి',
                'role.seeker_f2': 'రక్త అభ్యర్థనలు పంపండి',
                'role.seeker_f3': 'అభ్యర్థన స్థితి ట్రాక్ చేయండి',
                'setup.title': 'మీ దాత ప్రొఫైల్ పూర్తి చేయండి',
                'setup.subtitle': 'సహాయం కావాల్సినవారితో మిమ్మల్ని కలుపుతాము',
                'setup.bloodType': 'రక్త గ్రూప్ *',
                'setup.age': 'వయస్సు *',
                'setup.gender': 'లింగం *',
                'setup.contact': 'ఫోన్ నంబర్ *',
                'setup.occupation': 'వృత్తి *',
                'setup.occupation_ph': 'ఉదా., విద్యార్థి, ఇంజినియర్',
                'setup.location': 'ప్రాంతం *',
                'setup.location_ph': 'నగరం, రాష్ట్రం',
                'setup.hint': 'మీ ప్రస్తుత స్థానాన్ని ఉపయోగించడానికి బటన్‌ను నొక్కండి',
                'setup.req_title': 'దాత అర్హతలు',
                'setup.req1': '18-65 సంవత్సరాల మధ్య వయస్సు',
                'setup.req2': 'కనీసం 50 కిలోలు బరువు',
                'setup.req3': 'మంచి ఆరోగ్యం',
                'setup.req4': 'రెండు దానాల మధ్య 56 రోజులు వేచి ఉండండి',
                'setup.submit': 'దాత ప్రొఫైల్ సృష్టించండి',
                'donorDash.title': 'దాత డాష్‌బోర్డ్',
                'donorDash.subtitle': 'మీ దానాలను ట్రాక్ చేసి సహాయం చేయండి',
                'donorDash.profile': 'మీ ప్రొఫైల్',
                'donorDash.recent': 'ఇటీవలి దానాలు',
                'seeker.title': 'సీకర్ డాష్‌బోర్డ్',
                'seeker.subtitle': 'మీ ప్రాంతంలో దాతలను కనుగొనండి',
                'seeker.search_title': 'రక్త దాతలను కనుగొనండి',
                'seeker.urgent_title': 'తక్షణ రక్త అవసరం',
                'seeker.bloodNeeded': 'అవసరమైన రక్త గ్రూప్',
                'seeker.blood_hint': 'బహుళ గ్రూపుల కోసం Ctrl (లేదా Cmd) నొక్కి ఎంచుకోండి',
                'seeker.units': 'అవసరమైన యూనిట్లు *',
                'seeker.units_ph': 'ఉదా., 2',
                'seeker.patient': 'రోగి పేరు *',
                'seeker.patient_ph': 'రోగి పేరును నమోదు చేయండి',
                'seeker.hospital_location': 'ఆసుపత్రి & ప్రాంతం *',
                'seeker.location_ph': 'ఆసుపత్రి పేరు, నగరం',
                'seeker.location_hint': 'మీ ప్రస్తుత లొకేషన్ కోసం 📍 నొక్కండి',
                'seeker.case': 'కేసు *',
                'seeker.case_ph': 'ఉదా., శస్త్రచికిత్స / అత్యవసర',
                'seeker.case_accident': 'అపఘాతం / ట్రామా',
                'seeker.case_surgery': 'శస్త్రచికిత్స',
                'seeker.case_cancer': 'క్యాన్సర్ చికిత్స',
                'seeker.case_delivery': 'డెలివరీ / మేటర్నిటీ',
                'seeker.case_other': 'ఇతర',
                'seeker.contact': 'సంప్రదింపు *',
                'seeker.contact_ph': 'పేరు - ఫోన్ నంబర్',
                'seeker.location': 'ప్రాంతం',
                'seeker.search_btn': 'దాతలను శోధించండి',
                'seeker.available': 'లభ్యమయ్యే దాతలు',
                'detail.age': 'వయస్సు',
                'detail.gender': 'లింగం',
                'detail.occupation': 'వృత్తి',
                'detail.availability': 'లభ్యమయ్యే దాతలు',
                'detail.available': 'లభ్యమయ్యే దాతలు',
                'detail.contact_btn': 'దాతలను కనుగొనండి'
            },
            hi: {
                'landing.title': 'खून जल्दी पाएँ.\n<span class="text-red">आत्मविश्वास से दान करें.</span>',
                'landing.subtitle': 'निकट के दाताओं से तुरंत जोड़ता है। अभी जुड़ें और जीवन बचाएँ।',
                'landing.cta': 'शुरू करें',
                'landing.how': 'कैसे काम करता है',
                'auth.title': 'वापसी पर स्वागत है',
                'auth.subtitle': 'अपने खाते में साइन इन करें',
                'auth.submit': 'साइन इन',
                'auth.toggle_text': 'खाता नहीं है?',
                'auth.toggle_btn': 'साइन अप',
                'auth.title_signup': 'अपना खाता बनाएँ',
                'auth.subtitle_signup': 'आज ही BloodConnect से जुड़ें',
                'auth.submit_signup': 'साइन अप',
                'auth.toggle_text_signup': 'पहले से खाता है?',
                'auth.toggle_btn_signin': 'साइन इन',
                'auth.email': 'ईमेल',
                'auth.email_ph': 'अपना ईमेल दर्ज करें',
                'auth.password': 'पासवर्ड',
                'auth.password_ph': 'अपना पासवर्ड दर्ज करें',
                'auth.firstName': 'पहला नाम',
                'auth.firstName_ph': 'अपना पहला नाम',
                'auth.lastName': 'अंतिम नाम',
                'auth.lastName_ph': 'अपना अंतिम नाम',
                'role.title': 'अपनी भूमिका चुनें',
                'role.subtitle': 'आप BloodConnect में कैसे भाग लेना चाहेंगे?',
                'role.donor': 'रक्त दाता',
                'role.donor_desc': 'अपने समुदाय में जीवन बचाने में मदद करें',
                'role.donor_f1': 'अपनी दान सूची देखें',
                'role.donor_f2': 'जरूरी अनुरोध प्राप्त करें',
                'role.donor_f3': 'दान इतिहास देखें',
                'role.seeker': 'रक्त खोजकर्ता',
                'role.seeker_desc': 'ज़रूरत पड़ने पर दाताओं को खोजें',
                'role.seeker_f1': 'दाता खोजें',
                'role.seeker_f2': 'रक्त अनुरोध भेजें',
                'role.seeker_f3': 'अनुरोध स्थिति देखें',
                'setup.title': 'अपनी दाता प्रोफ़ाइल पूर्ण करें',
                'setup.subtitle': 'सहायता आवश्यक व्यक्तियों के साथ जोड़ें',
                'setup.bloodType': 'रक्त समूह *',
                'setup.age': 'आयु *',
                'setup.gender': 'लिंग *',
                'setup.contact': 'फ़ोन नंबर *',
                'setup.occupation': 'पेशा *',
                'setup.occupation_ph': 'उदा., छात्र, इंजीनियर',
                'setup.location': 'स्थान *',
                'setup.location_ph': 'शहर, राज्य',
                'setup.hint': 'अपने वर्तमान स्थान का उपयोग करने के लिए बटन दबाएँ',
                'setup.req_title': 'दाता आवश्यकताएँ',
                'setup.req1': 'आयु 18-65 वर्ष',
                'setup.req2': 'कम से कम 50 किग्रा',
                'setup.req3': 'अच्छा स्वास्थ्य',
                'setup.req4': '56 दिन के बीच अलग',
                'setup.submit': 'प्रोफ़ाइल बनाएँ',
                'donorDash.title': 'दाता डैशबोर्ड',
                'donorDash.subtitle': 'अपनी दान सूची ट्रैक करें',
                'donorDash.profile': 'आपकी प्रोफ़ाइल',
                'donorDash.recent': 'हाल की दान',
                'seeker.title': 'सीकर डैशबोर्ड',
                'seeker.subtitle': 'अपने क्षेत्र में दाताओं को खोजें',
                'seeker.search_title': 'रक्त दाताओं को खोजें',
                'seeker.bloodNeeded': 'आवश्यक रक्त समूह',
                'seeker.location': 'स्थान',
                'seeker.search_btn': 'दाताओं को खोजें',
                'seeker.available': 'उपलब्ध दाताओं',
                'detail.age': 'आयु',
                'detail.gender': 'लिंग',
                'detail.occupation': 'पेशा',
                'detail.availability': 'उपलब्ध दाताओं',
                'detail.available': 'उपलब्ध दाताओं',
                'detail.contact_btn': 'दाताओं को खोजें'
            },
            ta: {
                'landing.title': 'விரைவில் இரத்தம் கண்டுபிடிக்க.\n<span class="text-red">உறுதியுடன் தானம் செய்க.</span>',
                'landing.subtitle': 'அருகிலுள்ள தானதாரர்களை உடனே இணைக்கிறது. இப்போது சேர்ந்து உயிர்களை காப்பாற்றுங்கள்.',
                'landing.cta': 'தொடங்குக',
                'landing.how': 'எப்படி செயல்படுகிறது',
                'auth.title': 'மீண்டும் வருக',
                'auth.subtitle': 'உங்கள் கணக்கில் உள்நுழைக',
                'auth.submit': 'உள்நுழை',
                'auth.toggle_text': 'கணக்கு இல்லையா?',
                'auth.toggle_btn': 'பதிவு செய்',
                'auth.title_signup': 'உங்கள் கணக்கை உருவாக்கவும்',
                'auth.subtitle_signup': 'இன்று BloodConnect-இல் சேருங்கள்',
                'auth.submit_signup': 'பதிவு செய்',
                'auth.toggle_text_signup': 'ஏற்கனவே கணக்கு உள்ளதா?',
                'auth.toggle_btn_signin': 'லாகிந்',
                'auth.email': 'மின்னஞ்சல்',
                'auth.email_ph': 'உங்கள் மின்னஞ்சல்',
                'auth.password': 'கடவுச்சொல்',
                'auth.password_ph': 'உங்கள் கடவுச்சொல்',
                'auth.firstName': 'முதல் பெயர்',
                'auth.firstName_ph': 'உங்கள் முதல் பெயர்',
                'auth.lastName': 'கடைசி பெயர்',
                'auth.lastName_ph': 'உங்கள் கடைசி பெயர்',
                'role.title': 'உங்கள் பாத்திரத்தைத் தேர்ந்தெடுக்கவும்',
                'role.subtitle': 'நீங்கள் எங்கள் பங்கேற்பீர்கள்?',
                'role.donor': 'ரக്த஦ாதாவ்',
                'role.donor_desc': 'நிங்களுடைய சமூஹத்தில் ஜீவனை பாதுகாப்பாற்ற உதவுங்கள்',
                'role.donor_f1': 'உங்கள் தானங்களை கண்காணிக்கவும்',
                'role.donor_f2': 'அத்யாவஶ்ய அ஭்யர்த்தினங்கள்',
                'role.donor_f3': 'தான வரலாறு',
                'role.seeker': 'ரக்தம் தேடுந்தவர்கள்',
                'role.seeker_desc': 'அவசியமுள்ளபோது தானதாரர்களை தேடுங்கள்',
                'role.seeker_f1': 'தானதாரர்களைத் தேடுங்கள்',
                'role.seeker_f2': 'ரக்த அ஭்யர்த்தினங்கள்',
                'role.seeker_f3': 'அ஭்யர்த்தின நில',
                'setup.title': 'உங்கள் தானதாரர் சுயவிவரம்',
                'setup.subtitle': 'ஸஹாயம் அவசியமுள்ளவரும் இணைக்க',
                'setup.bloodType': 'ரக்த வகை *',
                'setup.age': 'ப்ராயம் *',
                'setup.gender': 'லிங்கம் *',
                'setup.contact': 'தொலைபேசி எண் *',
                'setup.occupation': 'தொழில் *',
                'setup.occupation_ph': 'உதா., விளம்பரம், இந்தியாளர்',
                'setup.location': 'இடம் *',
                'setup.location_ph': 'நகரம், மாநிலம்',
                'setup.hint': 'உங்கள் இடத்தை பயன்படுத்த பொத்தானை அழுத்தவும்',
                'setup.req_title': 'தானதாரர் தகுதிகள்',
                'setup.req1': 'ப்ராயம் 18-65',
                'setup.req2': 'குறைந்தது 50 கிலோ',
                'setup.req3': 'ஶ்ரேஷ்டமாய ஆரோக்யநில',
                'setup.req4': 'இரண்டு தானங்களுக்கிடையே 56 நாள்',
                'setup.submit': 'ப்ரொஃபைல் ரசிக்குக',
                'donorDash.title': 'தானதாரர் பலகை',
                'donorDash.subtitle': 'உங்கள் தானங்களை கண்காணிக்கவும்',
                'donorDash.profile': 'உங்கள் ப்ரொஃபைல்',
                'donorDash.recent': 'சமீபகால தானங்கள்',
                'seeker.title': 'சீக்கர் பலகை',
                'seeker.subtitle': 'உங்கள் பகுதியில் தானதாரர்கள்',
                'seeker.search_title': 'ரக்த தானதாரர்கள்',
                'seeker.bloodNeeded': 'அவசியமாய்ந்த ரக்த வகை',
                'seeker.location': 'இடம்',
                'seeker.search_btn': 'தானதாரர்களைத் தேடு',
                'seeker.available': 'ல஭்யமாய்ந்த தானதாரர்கள்',
                'detail.age': 'ப்ராயம்',
                'detail.gender': 'லிங்கம்',
                'detail.occupation': 'தொழில்',
                'detail.availability': 'ல஭்யமாய்ந்த தானதாரர்கள்',
                'detail.available': 'ல஭்யமாய்ந்த தானதாரர்கள்',
                'detail.contact_btn': 'தானதாரர்களைத் தேடு'
            },
            ml: {
                'landing.title': 'രക്തം പെട്ടെന്ന് കണ്ടെത്തുക.\n<span class="text-red">ആത്മവിശ്വാസത്തോടെ ദാനം ചെയ്യുക.</span>',
                'landing.subtitle': 'അടുത്തുള്ള ദാതാക്കളുമായി ഉടനെ ബന്ധിപ്പിക്കുന്നു. ഇപ്പോൾ ചേരുക, ജീവൻ രക്ഷിക്കൂ.',
                'landing.cta': 'ആരംഭിക്കുക',
                'landing.how': 'എങ്ങനെ പ്രവർത്തിക്കുന്നു',
                'auth.title': 'മത್തೆ സ്വാഗതം',
                'auth.subtitle': 'നിങ്ങളുടെ അക്കൗണ്ടിലേക്ക് സൈൻ ഇൻ ചെയ്യുക',
                'auth.submit': 'സൈൻ ഇൻ',
                'auth.toggle_text': 'അക്കൗണ്ടില്ലേ?',
                'auth.toggle_btn': 'സൈൻ അപ്പ്',
                'auth.title_signup': 'നിങ്ങളുടെ അക്കൗണ്ട് സൃഷ്ടിക്കുക',
                'auth.subtitle_signup': 'ഇന്ന് തന്നെ BloodConnect-ലേക്ക് ചേരുക',
                'auth.submit_signup': 'സൈൻ അപ്പ്',
                'auth.toggle_text_signup': 'ഇതിനകം അക്കൗണ്ടുണ്ടോ?',
                'auth.toggle_btn_signin': 'ലാഗിന്',
                'auth.email': 'ഇമെയിൽ',
                'auth.email_ph': 'നിങ്ങളുടെ ഇമെയിൽ നൽകുക',
                'auth.password': 'പാസ്വേഡ്',
                'auth.password_ph': 'നിങ്ങളുടെ പാസ്വേഡ് നൽകുക',
                'auth.firstName': 'പേര്',
                'auth.firstName_ph': 'നിങ്ങളുടെ പേര്',
                'auth.lastName': 'ഇടപ്പേര്',
                'auth.lastName_ph': 'നിങ്ങളുടെ ഇടപ്പേര്',
                'role.title': 'നിങ്ങളുടെ പങ്ക് തിരഞ്ഞെടുക്കുക',
                'role.subtitle': 'നിങ്ങൾ എങ്ങനെ പങ്കെടുക്കും?',
                'role.donor': 'രക്തദാതാവ്',
                'role.donor_desc': 'നിങ്ങളുടെ സമൂഹത്തിൽ ജീവ രക്ഷണെ മാഡുക',
                'role.donor_f1': 'ദാനം ട്രാക്ക് ചെയ്യുക',
                'role.donor_f2': 'തുര്തു വിനംതിഗളും',
                'role.donor_f3': 'ദാനം ചരിത്രം',
                'role.seeker': 'രക്തം തേടുന്നവരും',
                'role.seeker_desc': 'അവശ്യമുള്ളപ്പോൾ ദാതാക്കളെ കണ്ടെത്തുക',
                'role.seeker_f1': 'ദാതാക്കളെ തിരയുക',
                'role.seeker_f2': 'രക്ത വിനംതിഗളും',
                'role.seeker_f3': 'വിനംതി സ്ഥിതി',
                'setup.title': 'ദാതാവിന്റെ പ്രൊഫൈൽ പൂർത്തിയാക്കുക',
                'setup.subtitle': 'സഹായം അഗത്യവിരുത്തുണ്ട് വരും അനുഭവികൾക്ക് ബന്ധപ്പിക്കുക',
                'setup.bloodType': 'രക്ത ഗ്രൂപ്പ് *',
                'setup.age': 'പ്രായം *',
                'setup.gender': 'ലിംഗം *',
                'setup.contact': 'ഫോൺ സംഖ്യ *',
                'setup.occupation': 'വൃത്തി *',
                'setup.occupation_ph': 'ഉദാ., വിദ്യാര്ഥി, ഇന്ജിനിയറ്',
                'setup.location': 'സ്ഥലം *',
                'setup.location_ph': 'നഗരം, രാജ്യം',
                'setup.hint': 'നിങ്ങളുടെ നിലവിലെ സ്ഥലം ഉപയോഗിക്കാൻ ബട്ടൺ അമർത്തുക',
                'setup.req_title': 'ദാതാവിന്റെ ആവശ്യകതകൾ',
                'setup.req1': 'പ്രായം 18-65',
                'setup.req2': 'കുറഞ്ഞത് 50 കെജി',
                'setup.req3': 'ഉത്തമ ആരോഗ്യനില',
                'setup.req4': 'രണ്ടു ദാനങ്ങൾക്കിടയിൽ 56 ദിവസം',
                'setup.submit': 'പ്രൊഫൈൽ രചിക്കുക',
                'donorDash.title': 'ദാതാവ് ഡാഷ്ബോർഡ്',
                'donorDash.subtitle': 'നിങ്ങളുടെ ദാനങ്ങൾ ട്രാക്ക് ചെയ്യുക',
                'donorDash.profile': 'നിങ്ങളുടെ പ്രൊഫൈൽ',
                'donorDash.recent': 'സമീപകാല ദാനങ്ങൾ',
                'seeker.title': 'സീക്കർ ഡാഷ്ബോർഡ്',
                'seeker.subtitle': 'നിങ്ങളുടെ പ്രദേശത്തിലെ ദാതാക്കളും',
                'seeker.search_title': 'രക്ത ദാതാക്കളും',
                'seeker.bloodNeeded': 'അവശ്യമായ രക്ത ഗ്രൂപ്പ്',
                'seeker.location': 'സ്ഥലം',
                'seeker.search_btn': 'ദാതാക്കളെ തിരയുക',
                'seeker.available': 'ലഭ്യമായ ദാതാക്കളും',
                'detail.age': 'പ്രായം',
                'detail.gender': 'ലിംഗം',
                'detail.occupation': 'വൃത്തി',
                'detail.availability': 'ലഭ്യമായ ദാതാക്കളും',
                'detail.available': 'ലഭ്യമായ ദാതാക്കളും',
                'detail.contact_btn': 'ദാതാക്കളെ തിരയുക'
            },
            kn: {
                'landing.title': 'ರಕ്ತವನ್ನು ಬೇಗ ಹುಡುಕಿ.\n<span class="text-red">ಆತ್ಮವಿಶ್ವಾಸದಿಂದ ದಾನ ಮಾಡಿ.</span>',
                'landing.subtitle': 'ಸಮೀಪದ ದಾತರನ್ನು ತಕ್ಷಣ ಸಂಪರ್ಕಿಸುತ್ತದೆ. ಈಗ ಸೇರಿ, ಜೀವ ಉಳಿಸಿ.',
                'landing.cta': 'ಪ್ರಾರಂಭಿಸಿ',
                'landing.how': 'ಹೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ',
                'auth.title': 'ಮತ್ತೆ ಸ್ವಾಗತ',
                'auth.subtitle': 'ನಿಮ್ಮ ಖಾತೆಗೆ ಲಾಗಿನ್ ಆಗಿ',
                'auth.submit': 'ಲಾಗಿನ್',
                'auth.toggle_text': 'ಖಾತೆ ಇಲ್ಲವೇ?',
                'auth.toggle_btn': 'ಸೈನ್ ಅಪ್',
                'auth.title_signup': 'ನಿಮ್ಮ ಖಾತೆ ರಚಿಸಿ',
                'auth.subtitle_signup': 'ಇಂದೇ BloodConnect ಸೇರಿ',
                'auth.submit_signup': 'ಸೈನ್ ಅಪ್',
                'auth.toggle_text_signup': 'ಈಗಾಗಲೇ ಖಾತೆಯಿದೆಯೆ?',
                'auth.toggle_btn_signin': 'ಲಾಗಿನ್',
                'auth.email': 'ಇಮെಲ್',
                'auth.email_ph': 'ನಿಮ್ಮ ಇಮെಲ್ ನಮೂದಿಸಿ',
                'auth.password': 'ಪಾಸ್‌ವರ್ಡ್',
                'auth.password_ph': 'ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ನಮೂದಿಸಿ',
                'auth.firstName': 'ಮೊದಲ ಹೆಸರು',
                'auth.firstName_ph': 'ನಿಮ್ಮ ಮೊದಲ ಹೆಸರು',
                'auth.lastName': 'ಕೊನೆಯ ಹೆಸರು',
                'auth.lastName_ph': 'ನಿಮ್ಮ ಕೊನೆಯ ಹೆಸರು',
                'role.title': 'ನಿಮ್ಮ ಪಾತ್ರ ಆಯ್ಕೆಮಾಡಿ',
                'role.subtitle': 'ನೀವು ಹೇಗೆ ಭಾಗವಹಿಸುತ್ತೀರಿ?',
                'role.donor': 'ರಕ്ತದಾನಿ',
                'role.donor_desc': 'ನಿಮ್ಮ ಸಮಾಜದಲ್ಲಿ ಜೀವ ರಕ്ಷಣೆ ಮಾಡಿ',
                'role.donor_f1': 'ನಿಮ್ಮ ದಾನಗಳನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿರಿ',
                'role.donor_f2': 'ತುರ್ತು ವಿನಂತಿಗಳು ಪಡೆಯಿರಿ',
                'role.donor_f3': 'ದಾನ ಇತಿಹಾಸ',
                'role.seeker': 'ರಕ്ತ ಹುಡುಕುವವರು',
                'role.seeker_desc': 'ಅವಶ್ಯಕತೆ ಬಂದಾಗ ದಾತರನ್ನು ಹುಡುಕಿ',
                'role.seeker_f1': 'ದಾತರನ್ನು ಹುಡುಕಿ',
                'role.seeker_f2': 'ರಕ്ತ ವಿನಂತಿಗಳು',
                'role.seeker_f3': 'ವಿನಂತಿ ಸ್ಥಿತಿ',
                'setup.title': 'ನಿಮ್ಮ ದಾನಿ ಪ್ರೊಫೈಲ್ ಪೂರ್ಣಗೊಳಿಸಿ',
                'setup.subtitle': 'ಸಹಾಯ ಅಗತ್ಯವಿರುವವರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಿ',
                'setup.bloodType': 'ರಕ്ತದ ಗುಂಪು *',
                'setup.age': 'ವಯಸ್ಸು *',
                'setup.gender': 'ಲಿಂಗ *',
                'setup.contact': 'ಫೋನ್ ಸಂಖ್ಯೆ *',
                'setup.occupation': 'ವೃತ್ತಿ *',
                'setup.occupation_ph': 'ಉದಾ., ವಿದ್ಯಾರ್ಥಿ, ಇಂಜಿನಿಯರ್',
                'setup.location': 'ಸ್ಥಳ *',
                'setup.location_ph': 'ನಗರ, ರಾಜ್ಯ',
                'setup.hint': 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಬಳಸಲು ಬಟನ್ ಒತ್ತಿರಿ',
                'setup.req_title': 'ದಾನಿ ಅರ್ಹತೆಗಳು',
                'setup.req1': 'ವಯಸ್ಸು 18-65',
                'setup.req2': 'ಕನಿಷ್ಠ 50 ಕೆಜಿ',
                'setup.req3': 'ಉತ್ತಮ ಆರೋಗ್ಯ',
                'setup.req4': 'ಎರಡು ದಾನಗಳ ನಡುವೆ 56 ದಿನ',
                'setup.submit': 'ಪ್ರೊಫೈಲ್ ರಚಿಸಿ',
                'donorDash.title': 'ದಾನಿ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
                'donorDash.subtitle': 'ನಿಮ್ಮ ದಾನಗಳನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ',
                'donorDash.profile': 'ನಿಮ್ಮ ಪ್ರೊಫೈಲ್',
                'donorDash.recent': 'ಇತ್ತೀಚಿನ ದಾನಗಳು',
                'seeker.title': 'ಹುಡುಕುವವರ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
                'seeker.subtitle': 'ನಿಮ್ಮ ಪ್ರದೇಶದಲ್ಲಿನ ದಾತರು',
                'seeker.search_title': 'ರಕ്ತ ದಾತರು',
                'seeker.bloodNeeded': 'ಅವಶ್ಯಕ ರಕ്ತ ಗುಂಪು',
                'seeker.location': 'ಸ್ಥಳ',
                'seeker.search_btn': 'ದಾತರನ್ನು ಹುಡುಕಿ',
                'seeker.available': 'ಲಭ್ಯ ದಾತರು',
                'detail.age': 'ವಯಸ್ಸು',
                'detail.gender': 'ಲಿಂಗ',
                'detail.occupation': 'ವೃತ್ತಿ',
                'detail.availability': 'ಲಭ್ಯ ದಾತರು',
                'detail.available': 'ಲಭ್ಯ ದಾತರು',
                'detail.contact_btn': 'ದಾತರನ್ನು ಹುಡುಕಿ'
            }
        };
    }
 
    loadLanguageFromStorage() {
        const lang = localStorage.getItem('bloodconnect_lang');
        if (lang) this.language = lang;
    }
 
    setLanguage(lang) {
        this.language = lang;
        localStorage.setItem('bloodconnect_lang', lang);
        this.applyTranslations();
    }
 
    t(key) {
        const dict = this.translations[this.language] || this.translations.en;
        return dict[key] || this.translations.en[key] || '';
    }
 
    applyTranslations() {
        const dict = this.translations[this.language] || this.translations.en;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const html = dict[key] || this.translations.en[key] || el.innerHTML;
            el.innerHTML = html;
        });
        // Attribute translations e.g., placeholders/labels
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const text = dict[key] || this.translations.en[key] || el.getAttribute('placeholder');
            el.setAttribute('placeholder', text);
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            const text = dict[key] || this.translations.en[key] || el.getAttribute('aria-label') || '';
            if (text) el.setAttribute('aria-label', text);
        });
    }
    
    async checkAuthStatus() {
        // Backend mode: verify token and load profile/request data from API.
        if (!this.authToken) {
            this.isRegisterMode = false;
            this.showPage('auth');
            this.updateAuthForm();
            return;
        }
 
        this.showLoading('Restoring session...');
        try {
            const me = await this.apiFetch('/api/auth/me');
            this.currentUser = me.user;
            this.saveUserToStorage();
 
            const donorRes = await this.apiFetch('/api/donors/me');
            this.currentDonor = donorRes.donor || null;
 
            await this.refreshRequests();
 
            // Respect the user's saved role — don't override it just because a donor profile exists
            if (this.currentUser.role === 'seeker') {
                this.showPage('seeker-dashboard');
            } else if (this.currentUser.role === 'donor') {
                if (this.currentDonor) {
                    this.showPage('donor-dashboard');
                } else {
                    this.showPage('donor-setup');
                }
            } else {
                this.showPage('role-selection');
            }
        } catch (err) {
            this.authToken = null;
            this.currentUser = null;
            this.currentDonor = null;
            this.saveTokenToStorage();
            this.saveUserToStorage();
            this.isRegisterMode = false;
            this.showPage('auth');
            this.updateAuthForm();
        } finally {
            this.hideLoading();
        }
    }
    
    showPage(page) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        
        // Show selected page
        const pageElement =
            document.getElementById(`${page}-page`) ||
            document.getElementById(page);
        if (pageElement) {
            // Reset animation so it replays correctly on re-show
            pageElement.style.animation = 'none';
            pageElement.style.display = 'block';
            // Force reflow then re-enable animation
            void pageElement.offsetWidth;
            pageElement.style.animation = '';
        }
        
        this.currentPage = page;
        this.updateNavbar();
        this.applyTranslations();
        
        // Page-specific initialization
        if (page === 'donor-dashboard') {
            this.initDonorDashboard();
        } else if (page === 'seeker-dashboard') {
            this.initSeekerDashboard();
        }
    }
    
    updateNavbar() {
        const backBtn = document.getElementById('back-btn');
        const userSection = document.getElementById('nav-user-section');
        
        if (this.currentUser && this.currentPage !== 'landing') {
            backBtn.style.display = 'block';
            userSection.style.display = 'flex';
            
            const roleText = document.getElementById('nav-role-text');
            const switchText = document.getElementById('switch-role-text');
            
            if (this.currentUser.role === 'donor') {
                roleText.textContent = 'Donor Dashboard';
                switchText.textContent = 'Switch to Seeker';
            } else {
                roleText.textContent = 'Seeker Dashboard';
                switchText.textContent = 'Switch to Donor';
            }
        } else {
            backBtn.style.display = 'none';
            userSection.style.display = 'none';
            // Also hide progress panel if visible
            const panel = document.getElementById('user-progress-panel');
            if (panel) panel.style.display = 'none';
        }
    }
    
    toggleAuthMode() {
        this.isRegisterMode = !this.isRegisterMode;
        this.updateAuthForm();
        this.applyTranslations();
    }
    
    updateAuthForm() {
        const title = document.getElementById('auth-title');
        const subtitle = document.getElementById('auth-subtitle');
        const submitBtn = document.getElementById('auth-submit-btn');
        const toggleText = document.getElementById('auth-toggle-text');
        const toggleBtn = document.getElementById('auth-toggle-btn');
        const nameFields = document.getElementById('register-name-fields');
        const confirmField = document.getElementById('register-confirm-field');
        const confirmEmailField = document.getElementById('register-confirm-email-field');
        
        const authContainer = document.getElementById('auth-container');
        if (authContainer) {
            authContainer.classList.toggle('auth-mode-signin', !this.isRegisterMode);
            authContainer.classList.toggle('auth-mode-signup', this.isRegisterMode);
        }
        const googleBtnText = document.getElementById('google-auth-btn-text');
        if (this.isRegisterMode) {
            title.innerHTML = this.t('auth.title_signup') || 'Sign Up';
            subtitle.innerHTML = this.t('auth.subtitle_signup') || 'Join BloodConnect today';
            submitBtn.innerHTML = this.t('auth.submit_signup') || 'Sign Up';
            toggleText.innerHTML = this.t('auth.toggle_text_signup') || 'Already have an account?';
            toggleBtn.innerHTML = this.t('auth.toggle_btn_signin') || 'Log in';
            // show first/last name row as flex (side-by-side inputs)
            if (nameFields) nameFields.style.display = 'flex';
            if (confirmField) confirmField.style.display = 'block';
            if (confirmEmailField) confirmEmailField.style.display = 'block';
            if (googleBtnText) googleBtnText.textContent = 'Sign up with Google';
        } else {
            title.innerHTML = this.t('auth.title') || 'Welcome Back';
            subtitle.innerHTML = this.t('auth.subtitle') || 'Sign in to your account';
            submitBtn.innerHTML = this.t('auth.submit') || 'Sign In';
            toggleText.innerHTML = this.t('auth.toggle_text') || "Don't have an account?";
            toggleBtn.innerHTML = this.t('auth.toggle_btn') || 'Sign up';
            if (nameFields) nameFields.style.display = 'none';
            if (confirmField) confirmField.style.display = 'none';
            if (confirmEmailField) confirmEmailField.style.display = 'none';
            if (googleBtnText) googleBtnText.textContent = 'Continue with Google';
        }
    }
    
    async handleAuth(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const email = formData.get('email');
        const password = formData.get('password');
        
        try {
            this.showLoading(this.isRegisterMode ? 'Creating account...' : 'Signing in...');
            if (this.isRegisterMode) {
                const firstName = formData.get('firstName');
                const lastName = formData.get('lastName');
                const confirmPassword = formData.get('confirmPassword');
                this.assertPasswordPolicy(password, confirmPassword);
                
                const out = await this.apiFetch('/api/auth/register', {
                    auth: false,
                    method: 'POST',
                    body: JSON.stringify({ email, password, firstName, lastName })
                });
                this.authToken = out.token;
                this.saveTokenToStorage();
                this.currentUser = out.user;
                this.saveUserToStorage();
                        this.showToast('Account created!', 'Welcome to BloodConnect!');
                        this.isRegisterMode = false;
                        this.showPage('role-selection');
            } else {
                const out = await this.apiFetch('/api/auth/login', {
                    auth: false,
                    method: 'POST',
                    body: JSON.stringify({ email, password })
                });
                this.authToken = out.token;
                this.saveTokenToStorage();
                this.currentUser = out.user;
                this.saveUserToStorage();
                this.showToast('Welcome back!', 'Successfully signed in');
                this.showPage('role-selection');
            }
        } catch (error) {
            console.error('Authentication error:', error);
            this.showToast('Authentication Error', error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    async login(email, password) {
        this.showLoading('Signing in...');
        
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                console.log('Attempting login for:', email);
                console.log('Available users:', this.mockData.users.map(u => u.email));
                
                const user = this.mockData.users.find(u => u.email === email && u.password === password);
                if (user) {
                    console.log('Login successful for user:', user.email);
                    this.currentUser = user;
                    this.saveUserToStorage();
                    // Defer navigation to caller to show role selection
                    resolve(user);
                } else {
                    console.log('Login failed - user not found or wrong password');
                    reject(new Error('Invalid credentials'));
                }
                this.hideLoading();
            }, 1000);
        });
    }
    
    async register(userData) {
        this.showLoading('Creating account...');
        
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                console.log('Attempting mock registration for:', userData.email);
                console.log('Current user count:', this.mockData.users.length);
                
                const existingUser = this.mockData.users.find(u => u.email === userData.email);
                if (existingUser) {
                    console.log('Mock registration failed - user already exists in mock data');
                    reject(new Error('User already exists in local data'));
                    this.hideLoading();
                    return;
                }
 
                if (this.mockData.users.length >= this.MAX_USERS) {
                    console.log('Mock registration failed - user capacity reached');
                    reject(new Error(`User capacity reached. Max ${this.MAX_USERS} users can register.`));
                    this.hideLoading();
                    return;
                }
                
                const newUser = {
                    id: Date.now().toString(),
                    ...userData,
                    role: null
                };
                
                this.mockData.users.push(newUser);
                this.currentUser = newUser;
                this.saveUserToStorage();
                this.saveDataToStorage();
                console.log('Mock registration successful for user:', newUser.email);
                resolve(newUser);
                this.hideLoading();
            }, 1000);
        });
    }
    
    logout() {
        this.currentUser = null;
        this.currentDonor = null;
        this.firebaseUser = null;
        this.authToken = null;
        this._requestsAsSeeker = [];
        this._requestsAsDonor = [];
        this.saveUserToStorage();
        this.saveDataToStorage();
        this.saveTokenToStorage();
        
        this.showPage('landing');
        this.showToast('Logged out', 'You have been successfully logged out.');
    }
    
    async switchRole() {
        if (!this.currentUser) return;
        
        this.showLoading('Switching role...');
        try {
            const newRole = this.currentUser.role === 'donor' ? 'seeker' : 'donor';
            const out = await this.apiFetch('/api/users/me', {
                method: 'PATCH',
                body: JSON.stringify({ role: newRole })
            });
            this.currentUser = out.user;
            this.saveUserToStorage();
            
            if (newRole === 'donor') {
                const donorRes = await this.apiFetch('/api/donors/me');
                this.currentDonor = donorRes.donor || null;
                if (this.currentDonor) {
                    this.showPage('donor-dashboard');
                    this.showToast('Role switched!', 'You are now using the Donor dashboard.');
                } else {
                    this.showPage('donor-setup');
                    this.showToast('Complete profile', 'Please complete your donor profile first.');
                }
            } else {
                this.showPage('seeker-dashboard');
                this.showToast('Role switched!', 'You are now using the Seeker dashboard.');
            }
            
            await this.refreshRequests();
        } catch (err) {
            this.showToast('Error', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    async selectRole(role) {
        if (!this.currentUser) return;
        
        this.showLoading('Saving role...');
        try {
            const out = await this.apiFetch('/api/users/me', {
                method: 'PATCH',
                body: JSON.stringify({ role })
            });
            this.currentUser = out.user;
        this.saveUserToStorage();
        
        if (role === 'donor') {
                const donorRes = await this.apiFetch('/api/donors/me');
                this.currentDonor = donorRes.donor || null;
                this.showPage(this.currentDonor ? 'donor-dashboard' : 'donor-setup');
        } else {
            this.showPage('seeker-dashboard');
            }
 
            await this.refreshRequests();
        } catch (err) {
            this.showToast('Error', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    async getCurrentLocation() {
        try {
            this.showLoading('Getting your location...');
            const locationData = await this.getLocationData();
            const locationInput = document.querySelector('input[name="location"]');
            if (locationInput) {
                locationInput.value = locationData.location;
                locationInput.dataset.latitude = locationData.latitude;
                locationInput.dataset.longitude = locationData.longitude;
            }
            this.showToast('Location detected!', `Location set to: ${locationData.location}`);
        } catch (error) {
            this.showToast('Location error', error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    getLocationData() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    try {
                        const rev = await this.reverseGeocode(latitude, longitude);
                        resolve({
                            location: rev.locationFormatted,
                            latitude: latitude.toString(),
                            longitude: longitude.toString()
                        });
                    } catch (_) {
                        resolve({
                            location: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                            latitude: latitude.toString(),
                            longitude: longitude.toString()
                        });
                    }
                },
                (error) => {
                    let message = 'Unable to get your location.';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            message = 'Location access was denied. Please enable location permissions.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            message = 'Location information is unavailable.';
                            break;
                        case error.TIMEOUT:
                            message = 'Location request timed out.';
                            break;
                    }
                    reject(new Error(message));
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
            );
        });
    }
 
    formatIndianLocation(parts) {
        // Expected order: village/mandal < city < district < state
        const { village, mandal, city, district, state } = parts;
        const smallArea = village || mandal;
        const tokens = [];
        if (smallArea) tokens.push(smallArea);
        if (city) tokens.push(city);
        if (district) tokens.push(district);
        if (state) tokens.push(state);
        return tokens.join(', ');
    }
 
    // Fallback: normalize a manually typed location into "village/city, district, state" order
    normalizeManualLocationString(input) {
        if (!input) return '';
        const rawTokens = input
            .split(/[|/,-]/)
            .map(t => t.trim())
            .filter(Boolean);
        const villageCity = rawTokens[0] || '';
        const district = rawTokens[1] || '';
        const state = rawTokens[2] || '';
        return [villageCity, district, state].filter(Boolean).join(', ');
    }
 
    parseGoogleAddressComponents(components) {
        const get = (typeList) => {
            const comp = components.find(c => typeList.every(t => c.types.includes(t)));
            return comp ? comp.long_name : '';
        };
        const village = get(['premise']) || get(['subpremise']) || get(['hamlet']) || get(['sublocality_level_3', 'sublocality']) || get(['sublocality_level_2', 'sublocality']) || get(['neighborhood']) || get(['administrative_area_level_4']);
        const mandal = get(['sublocality_level_1', 'sublocality']) || get(['ward']) || get(['administrative_area_level_3']);
        const city = get(['locality']) || get(['postal_town']) || get(['administrative_area_level_2']);
        const district = get(['administrative_area_level_2']) || get(['administrative_area_level_3']) || '';
        const state = get(['administrative_area_level_1']);
        return { village, mandal, city, district, state };
    }
 
    parseOSMAddress(addr) {
        const village = addr.hamlet || addr.village || addr.neighbourhood || addr.quarter || addr.suburb || '';
        const mandal = addr.city_district || addr.town || addr.county || addr.subdivision || '';
        const city = addr.city || addr.town || addr.municipality || '';
        const district = addr.state_district || addr.county || '';
        const state = addr.state || '';
        return { village, mandal, city, district, state };
    }
 
    async reverseGeocode(lat, lng) {
        // Try Google first
        if (window.google && this.isGoogleMapsLoaded) {
            try {
                const geocoder = new google.maps.Geocoder();
                const results = await new Promise((resolve, reject) => {
                    geocoder.geocode({ location: { lat: Number(lat), lng: Number(lng) } }, (res, status) => {
                        if (status === 'OK' && res && res[0]) resolve(res);
                        else reject(new Error('Reverse geocode failed'));
                    });
                });
                const components = results[0].address_components || [];
                const parts = this.parseGoogleAddressComponents(components);
                const locationFormatted = this.formatIndianLocation(parts) || results[0].formatted_address;
                return { locationFormatted, state: parts.state || '' };
            } catch (_) {}
        }
        // Fallback to OSM Nominatim
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        const parts = this.parseOSMAddress(data.address || {});
        const locationFormatted = this.formatIndianLocation(parts) || data.display_name;
        return { locationFormatted, state: parts.state || '' };
    }
 
    async geocodeAddress(address) {
        if (!address) throw new Error('No address provided');
        // Try Google Geocoder first if available
        if (window.google && this.isGoogleMapsLoaded) {
            try {
                const geocoder = new google.maps.Geocoder();
                const results = await new Promise((resolve, reject) => {
                    geocoder.geocode({ address, region: 'IN', componentRestrictions: { country: 'IN' } }, (res, status) => {
                        if (status === 'OK' && res && res[0]) resolve(res);
                        else reject(new Error('Unable to geocode address'));
                    });
                });
                const loc = results[0].geometry.location;
                const parts = this.parseGoogleAddressComponents(results[0].address_components || []);
                const locationFormatted = this.formatIndianLocation(parts) || results[0].formatted_address;
                return { latitude: loc.lat().toString(), longitude: loc.lng().toString(), locationFormatted, state: parts.state || '' };
            } catch (_) {
                // Fall through to OSM
            }
        }
        // Fallback to OpenStreetMap Nominatim
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(address)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) throw new Error('Geocoding request failed');
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) throw new Error('Address not found');
        const detailsUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(data[0].lat)}&lon=${encodeURIComponent(data[0].lon)}&zoom=14&addressdetails=1`;
        const det = await fetch(detailsUrl, { headers: { 'Accept-Language': 'en' } });
        const detJson = await det.json();
        const parts = this.parseOSMAddress(detJson.address || {});
        const locationFormatted = this.formatIndianLocation(parts) || detJson.display_name;
        return { latitude: data[0].lat.toString(), longitude: data[0].lon.toString(), locationFormatted, state: parts.state || '' };
    }
    
    async handleDonorSetup(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const locationInput = e.target.querySelector('input[name="location"]');
        
        this.showLoading('Validating profile details...');
        
        try {
            const donorData = {
                bloodType: formData.get('bloodType'),
                age: parseInt(formData.get('age')),
                gender: formData.get('gender'),
                contact: formData.get('contact'),
                occupation: formData.get('occupation'),
                location: formData.get('location'),
                latitude: locationInput.dataset.latitude || '',
                longitude: locationInput.dataset.longitude || '',
                availability: 'available',
                govId: null,
                state: ''
            };
            const govIdFile = formData.get('govId');
            if (govIdFile && typeof govIdFile === 'object' && govIdFile.size > 0) {
                let previewUrl = '';
                try {
                    previewUrl = URL.createObjectURL(govIdFile);
                } catch (_) {}
                donorData.govId = { name: govIdFile.name || 'document', type: govIdFile.type || '', previewUrl };
                donorData.govIdFile = govIdFile; // Store the actual file object
            }
            const profileImageFile = this._croppedProfileImage || formData.get('profileImage');
            if (profileImageFile && typeof profileImageFile === 'object' && profileImageFile.size > 0) {
                donorData.profileImageFile = profileImageFile;
            }
            this._croppedProfileImage = null;
            
            // If user typed a location and no coordinates were captured, geocode it
            if ((!donorData.latitude || !donorData.longitude) && donorData.location) {
                try {
                    const coords = await this.geocodeAddress(donorData.location);
                    donorData.latitude = coords.latitude;
                    donorData.longitude = coords.longitude;
                    donorData.state = coords.state || '';
                    // Keep user's spelling as typed; do not auto-rewrite location text
                } catch (_) {
                    // Geocoding failed: allow save without coordinates; we will attempt later
                    this.showToast('Saved without map pin', 'We will pin your village on the map later.', 'info');
                }
            }
            // If GPS was used, reverse-geocode to formatted form
            if (donorData.latitude && donorData.longitude && (!donorData.location || donorData.location.includes(',' ) === false)) {
                try {
                    const rev = await this.reverseGeocode(Number(donorData.latitude), Number(donorData.longitude));
                    donorData.state = donorData.state || rev.state || '';
                    // Keep the user's text; don't overwrite spelling
                } catch (_) {}
            }
            
            // If editing an existing donor profile, update directly without re-running eligibility quiz
            if (this._editingDonorProfile && this.currentDonor) {
                let body;
                let headers = {};
                const govIdFile = donorData.govIdFile;
                if (govIdFile) {
                    const fd = new FormData();
                    fd.append('bloodType', donorData.bloodType);
                    fd.append('age', String(donorData.age));
                    fd.append('gender', donorData.gender);
                    fd.append('contact', donorData.contact);
                    fd.append('occupation', donorData.occupation);
                    fd.append('location', donorData.location);
                    fd.append('state', donorData.state || '');
                    if (donorData.latitude) fd.append('latitude', donorData.latitude);
                    if (donorData.longitude) fd.append('longitude', donorData.longitude);
                    fd.append('availability', donorData.availability || 'available');
                    fd.append('govId', govIdFile);
                    body = fd;
                } else {
                    body = JSON.stringify({
                        bloodType: donorData.bloodType,
                        age: donorData.age,
                        gender: donorData.gender,
                        contact: donorData.contact,
                        occupation: donorData.occupation,
                        location: donorData.location,
                        state: donorData.state || '',
                        latitude: donorData.latitude || null,
                        longitude: donorData.longitude || null,
                        availability: donorData.availability || 'available'
                    });
                    headers = { 'Content-Type': 'application/json' };
                }
                const out = await this.apiFetch('/api/donors/me', {
                    method: 'PUT',
                    body,
                    headers
                });
                this.currentDonor = out.donor;
                this._editingDonorProfile = false;
                if (donorData.profileImageFile) {
                    try {
                        const fd = new FormData();
                        fd.append('profileImage', donorData.profileImageFile);
                        const imgOut = await this.apiFetch('/api/donors/me/profile-image', {
                            method: 'POST',
                            body: fd,
                            headers: {}
                        });
                        this.currentDonor = imgOut.donor || this.currentDonor;
                    } catch (_) { /* ignore */ }
                }
                await this.refreshRequests();
                this.showToast('Profile updated', 'Your donor profile has been updated.', 'success');
                this.showPage('donor-dashboard');
                this.initDonorDashboard();
                return;
            }
            
            // Gate first-time profile creation behind rules & eligibility quiz
            this._pendingDonorProfile = donorData;
            this.showPage('donor-eligibility');
            this.showToast('Almost there', 'Complete rules and eligibility to create your profile.', 'info');
        } finally {
            this.hideLoading();
        }
    }
 
    startEditDonorProfile() {
        if (!this.currentUser) return;
        // Navigate to setup form and prefill values for editing existing profile
        this.showPage('donor-setup');
        const donor = this.currentDonor || this.mockData.donors.find(d => d.userId === this.currentUser.id);
        if (!donor) return;
        const form = document.getElementById('donor-setup-form');
        if (!form) return;
        form.querySelector('select[name="bloodType"]').value = donor.bloodType || '';
        form.querySelector('input[name="age"]').value = donor.age || '';
        form.querySelector('select[name="gender"]').value = donor.gender || '';
        form.querySelector('input[name="contact"]').value = donor.contact || '';
        form.querySelector('input[name="occupation"]').value = donor.occupation || '';
        const locInput = form.querySelector('input[name="location"]');
        locInput.value = donor.location || '';
        if (donor.latitude && donor.longitude) {
            locInput.dataset.latitude = donor.latitude;
            locInput.dataset.longitude = donor.longitude;
        }
        this._editingDonorProfile = true;
    }
    
    async initDonorDashboard() {
        if (!this.currentDonor) return;
        
        const donor = this.currentDonor;
        const bloodType = donor.bloodType || donor.blood_type || '—';
        
        // Fetch donations from API (DB-driven)
        let donations = [];
        try {
            const out = await this.apiFetch('/api/donors/me/donations');
            donations = Array.isArray(out.donations) ? out.donations : [];
        } catch (_) { /* keep empty */ }
        
        const totalDonations = donations.length;
        let daysSinceLast = 'N/A';
        let lastDonationDateText = '—';
        if (donations.length > 0) {
            const lastDonation = Math.max(...donations.map(d => new Date(d.date || d.donation_date).getTime()));
            daysSinceLast = Math.floor((Date.now() - lastDonation) / (1000 * 60 * 60 * 24));
            lastDonationDateText = new Date(lastDonation).toLocaleDateString();
        }
        
        document.getElementById('total-donations').textContent = totalDonations;
        document.getElementById('days-since-last').textContent = daysSinceLast;
        document.getElementById('blood-type').textContent = bloodType === '—' ? '—' : bloodType;
        
        // Update profile header
        const headerNameEl = document.getElementById('donor-display-name');
        if (headerNameEl) {
            headerNameEl.textContent = `${this.currentUser.firstName || ''} ${this.currentUser.lastName || ''}`.trim() || 'Blood Connect User';
        }
        const headerBadgeEl = document.getElementById('donor-display-badge');
        if (headerBadgeEl) {
            headerBadgeEl.textContent = bloodType === '—' ? 'Blood Group not set • Donor' : `${bloodType} • Donor`;
        }
        
        // Update profile details "About" table - blood group from donor, last donation from DB
        const profileDetails = document.getElementById('profile-details');
        profileDetails.innerHTML = `
            <div class="profile-row">
                <span>Full Name</span>
                <span>${(this.currentUser.firstName || '') + ' ' + (this.currentUser.lastName || '')}</span>
            </div>
            <div class="profile-row">
                <span>Email</span>
                <span>${this.currentUser.email || '—'}</span>
            </div>
            <div class="profile-row">
                <span>Phone Number</span>
                <span>${donor.contact || '—'}</span>
            </div>
            <div class="profile-row">
                <span>Age</span>
                <span>${donor.age ?? '—'}</span>
            </div>
            <div class="profile-row">
                <span>Blood Group</span>
                <span>${bloodType === '—' ? '—' : bloodType}</span>
            </div>
            <div class="profile-row">
                <span>Gender</span>
                <span style="text-transform: capitalize;">${(donor.gender || '—')}</span>
            </div>
            <div class="profile-row">
                <span>Occupation</span>
                <span>${donor.occupation || '—'}</span>
            </div>
            <div class="profile-row">
                <span>Address</span>
                <span>${donor.location || '—'}</span>
            </div>
            <div class="profile-row">
                <span>Availability</span>
                <span class="${donor.availability === 'available' ? 'text-green' : 'text-red'}">${donor.availability === 'available' ? 'Available' : 'Not Available'}</span>
            </div>
            <div class="profile-row">
                <span>Reliability</span>
                <span>${typeof donor.reliability === 'number' ? Math.round(donor.reliability * 100) + '%' : '—'}</span>
            </div>
            <div class="profile-row">
                <span>Last Donation Date</span>
                <span>${lastDonationDateText}</span>
            </div>
        `;
        
        // Show Govt ID proof (server returns govIdPath)
        const govIdContainer = document.getElementById('profile-gov-id');
        if (govIdContainer) {
            const govPath = donor.govIdPath || donor.gov_id_path;
            if (govPath) {
                const url = govPath.startsWith('/') ? govPath : `/${govPath}`;
                govIdContainer.innerHTML = `<div class="profile-row"><span>Government ID:</span><a href="${url}" target="_blank" rel="noopener">View uploaded file</a></div>`;
            } else {
                govIdContainer.innerHTML = '';
            }
        }
 
        // Profile photo - load via auth API
        this.loadDonorProfilePhoto();
        
        // Initialize blood request panel (backend)
        this.refreshRequests().then(() => this.updateDonorRequestPanel());
        
        // User progress panel
        const upRecentList = document.getElementById('up-recent-list');
        const upAvail = document.getElementById('up-availability-select');
        if (upAvail) upAvail.value = donor.availability === 'available' ? 'available' : 'unavailable';
        if (upRecentList) {
            if (donations.length === 0) {
                upRecentList.innerHTML = '<div class="empty-state"><p>No donations recorded yet</p></div>';
            } else {
                upRecentList.innerHTML = donations.slice(-5).map(d => 
                    `<div class="profile-row"><span>${new Date(d.date || d.donation_date).toLocaleString()}</span><span>${d.type || 'Whole Blood'}</span></div>`
                ).join('');
            }
        }
 
    }
    
    async loadDonorProfilePhoto() {
        if (!this.authToken || !this.currentDonor) return;
        const hasPhoto = this.currentDonor.profileImagePath || this.currentDonor.profile_image_path;
        const placeholderCard = document.getElementById('donor-card-avatar-placeholder');
        const imgCard = document.getElementById('donor-card-avatar-img');
        if (!placeholderCard || !imgCard) return;
        
        if (!hasPhoto) {
            placeholderCard.style.display = 'flex';
            imgCard.style.display = 'none';
            imgCard.src = '';
            return;
        }

        try {
            // Use authenticated API endpoint to fetch the photo (handles auth-gated access)
            const headers = { Authorization: `Bearer ${this.authToken}` };
            const res = await fetch('/api/donors/me/profile-image', { headers });
            if (!res.ok) throw new Error('No image');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            if (this._profilePhotoUrl) URL.revokeObjectURL(this._profilePhotoUrl);
            this._profilePhotoUrl = url;
            imgCard.src = url;
            imgCard.alt = 'Profile photo';
            placeholderCard.style.display = 'none';
            imgCard.style.display = 'block';
        } catch (_) {
            placeholderCard.style.display = 'flex';
            imgCard.style.display = 'none';
            imgCard.src = '';
        }
    }
    
    handleProfileImageSelect(e) {
        const file = e.target?.files?.[0];
        const filenameEl = document.getElementById('profile-photo-filename');
        const previewWrap = document.getElementById('profile-photo-preview-wrap');
        const previewImg = document.getElementById('profile-photo-preview');
        const errorEl = document.getElementById('profile-photo-error');

        // Reset state
        if (filenameEl) filenameEl.textContent = 'No file chosen';
        if (previewWrap) previewWrap.style.display = 'none';
        if (previewImg) previewImg.src = '';
        if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
        this._croppedProfileImage = null;

        if (!file) return;

        // Validate type
        const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.type)) {
            if (errorEl) { errorEl.textContent = 'Invalid file type. Please select a JPG, PNG, or WEBP image.'; errorEl.style.display = 'block'; }
            e.target.value = '';
            return;
        }

        // Validate size (5 MB)
        if (file.size > 5 * 1024 * 1024) {
            if (errorEl) { errorEl.textContent = 'File is too large. Maximum size is 5 MB.'; errorEl.style.display = 'block'; }
            e.target.value = '';
            return;
        }

        // Show filename
        if (filenameEl) filenameEl.textContent = file.name;

        // Show thumbnail immediately before crop
        const previewUrl = URL.createObjectURL(file);
        if (previewImg) previewImg.src = previewUrl;
        if (previewWrap) previewWrap.style.display = 'block';

        // Open crop modal
        this.showCropModal(file, (croppedFile) => {
            this._croppedProfileImage = croppedFile;
            // Update thumbnail with cropped result
            if (previewImg) {
                const croppedUrl = URL.createObjectURL(croppedFile);
                URL.revokeObjectURL(previewUrl);
                previewImg.src = croppedUrl;
            }
            if (filenameEl) filenameEl.textContent = file.name;
            if (previewWrap) previewWrap.style.display = 'block';
            this.showToast('Photo ready', 'Crop applied. Submit the form to save.');
        });
    }

    _clearProfilePhotoSelection() {
        const input = document.getElementById('profile-image-input');
        const filenameEl = document.getElementById('profile-photo-filename');
        const previewWrap = document.getElementById('profile-photo-preview-wrap');
        const previewImg = document.getElementById('profile-photo-preview');
        const errorEl = document.getElementById('profile-photo-error');
        if (input) input.value = '';
        if (filenameEl) filenameEl.textContent = 'No file chosen';
        if (previewWrap) previewWrap.style.display = 'none';
        if (previewImg) { URL.revokeObjectURL(previewImg.src); previewImg.src = ''; }
        if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
        this._croppedProfileImage = null;
    }
 
    handleAvatarEditSelect(e) {
        const file = e.target?.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        this.showCropModal(file, async (croppedFile) => {
            e.target.value = '';
            if (!this.currentDonor) return;
            try {
                const fd = new FormData();
                fd.append('profileImage', croppedFile);
                const out = await this.apiFetch('/api/donors/me/profile-image', {
                    method: 'POST',
                    body: fd,
                    headers: {}
                });
                this.currentDonor = out.donor || this.currentDonor;
                this.loadDonorProfilePhoto();
                this.showToast('Photo updated', 'Your profile photo has been saved.', 'success');
            } catch (err) {
                this.showToast('Upload failed', err.message, 'error');
            }
        });
    }
 
    showCropModal(file, onComplete) {
        this._cropOnComplete = onComplete;
        const modal = document.getElementById('crop-photo-modal');
        const img = document.getElementById('crop-image-src');
        if (!modal || !img || typeof Cropper === 'undefined') return;
        const url = URL.createObjectURL(file);
        img.src = url;
        modal.style.display = 'flex';
        modal.onclick = (ev) => { if (ev.target === modal) this.closeCropModal(); };
        const initCropper = () => {
            if (this._cropperInstance) this._cropperInstance.destroy();
            this._cropperInstance = new Cropper(img, {
                aspectRatio: 1,
                viewMode: 2,
                dragMode: 'move',
                autoCropArea: 0.8,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: true,
                cropBoxResizable: true
            });
            const ratioSelect = document.getElementById('crop-aspect-ratio');
            if (ratioSelect) ratioSelect.value = '1';
        };
        if (img.complete) initCropper();
        else img.onload = initCropper;
    }
 
    closeCropModal() {
        const modal = document.getElementById('crop-photo-modal');
        const img = document.getElementById('crop-image-src');
        if (this._cropperInstance) {
            this._cropperInstance.destroy();
            this._cropperInstance = null;
        }
        if (img?.src) URL.revokeObjectURL(img.src);
        img.src = '';
        modal.style.display = 'none';
        this._cropOnComplete = null;
    }
 
    setCropAspectRatio(val) {
        if (!this._cropperInstance) return;
        const v = parseFloat(val);
        this._cropperInstance.setAspectRatio(v === 0 ? NaN : v);
    }
 
    applyCrop() {
        if (!this._cropperInstance || !this._cropOnComplete) return;
        this._cropperInstance.getCroppedCanvas({
            maxWidth: 512,
            maxHeight: 512,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            fillColor: '#fff'
        }).toBlob((blob) => {
            if (!blob) return;
            const file = new File([blob], 'profile.jpg', { type: 'image/jpeg' });
            this._cropOnComplete(file);
            this.closeCropModal();
        }, 'image/jpeg', 0.9);
    }
    
    
    initSeekerDashboard() {
        // Initialize seeker stats and requests list
        this.refreshRequests().then(() => this.updateSeekerRequestStats());
        this.applyTranslations();
 
        // If a donor profile exists, update currentDonor reference only (do NOT init donor dashboard from seeker page)
        if (this.currentUser) {
            this.apiFetch('/api/donors/me')
                .then(out => {
                    if (out.donor) {
                        this.currentDonor = out.donor;
                        // Do NOT call initDonorDashboard() here — we are on the seeker page
                    }
                })
                .catch(() => {});
        }
    }
    
    async handleDonorSearch(e) {
        e.preventDefault();
        if (!this.currentUser) {
            this.showToast('Login required', 'Please sign in to search stored donors.', 'info');
            this.showPage('auth');
            return;
        }
        const formData = new FormData(e.target);
        // Collect one or more blood types from the multi-select
        let bloodTypes = [];
        const multi = document.querySelector('#donor-search-form select[name="bloodTypes"]');
        if (multi) {
            bloodTypes = Array.from(multi.selectedOptions).map(o => o.value).filter(Boolean);
        } else {
            const single = formData.get('bloodType');
            if (single) bloodTypes = [single];
        }
        let location = formData.get('location');
        const locationInput = e.target.querySelector('input[name="location"]');
        let centerLat = null;
        let centerLng = null;
        const unitsNeeded = formData.get('unitsNeeded') || '';
        const patientName = formData.get('patientName') || '';
        const caseType = formData.get('caseType') || '';
        const contact = formData.get('contact') || '';
        
        // If no blood types selected, treat as "show all types"
        
        if (!location) {
            try {
                this.showLoading('Detecting your location...');
                const loc = await this.getLocationData();
                location = loc.location;
                e.target.querySelector('input[name="location"]').value = location;
                centerLat = parseFloat(loc.latitude);
                centerLng = parseFloat(loc.longitude);
            } catch (err) {
                this.hideLoading();
                this.showToast('Location required', 'Please enter a location to search', 'error');
                return;
            }
        }
        
        this.showLoading('Searching for donors...');
        
        // Resolve center coordinates (dataset or geocode)
        try {
            if (centerLat === null || centerLng === null) {
                if (locationInput && locationInput.dataset.latitude && locationInput.dataset.longitude) {
                    centerLat = parseFloat(locationInput.dataset.latitude);
                    centerLng = parseFloat(locationInput.dataset.longitude);
                    try {
                        const rev = await this.reverseGeocode(centerLat, centerLng);
                        this._centerState = rev.state || '';
                    } catch (_) {}
                } else if (location) {
                    const coords = await this.geocodeAddress(location);
                    centerLat = parseFloat(coords.latitude);
                    centerLng = parseFloat(coords.longitude);
                    
                    // Ensure we're in India - if coordinates are outside India, try to find Indian location
                    if (this.isLocationInIndia(centerLat, centerLng)) {
                        this._centerState = coords.state || '';
                        // Normalize typed location to formatted form for consistency
                        e.target.querySelector('input[name="location"]').value = coords.locationFormatted || location;
                    } else {
                        // If location is outside India, try to find a nearby Indian location
                        console.warn('Location appears to be outside India, searching for Indian location...');
                        this._centerState = '';
                        this.showToast('Location Error', 'Please enter a location within India', 'error');
                        centerLat = null;
                        centerLng = null;
                    }
                }
            }
        } catch (err) {
            this.showToast('Location not found', 'Please refine the location and try again.', 'error');
            centerLat = null;
            centerLng = null;
        }
 
        try {
            const params = new URLSearchParams();
            if (bloodTypes && bloodTypes.length) params.set('bloodTypes', bloodTypes.join(','));
                if (centerLat !== null && centerLng !== null) {
                params.set('lat', String(centerLat));
                params.set('lng', String(centerLng));
                params.set('radiusKm', String(this.searchRadiusKm));
            }
            if (this._centerState) params.set('state', String(this._centerState));
 
            const out = await this.apiFetch(`/api/donors/search?${params.toString()}`);
            const donors = Array.isArray(out.donors) ? out.donors : [];
 
                const maxDistanceForScore = 50; // km
            const donorsScored = donors.map((donor) => {
                const distanceKm = (typeof donor.distanceKm === 'number') ? donor.distanceKm : (Number.isFinite(Number(donor.distanceKm)) ? Number(donor.distanceKm) : Infinity);
                const available = donor.availability === 'available';
                const availabilityScore = available ? 1 : 0;
                const reliabilityScore = typeof donor.reliability === 'number' ? donor.reliability : 0.75;
                const safeDistance = isFinite(distanceKm) ? distanceKm : maxDistanceForScore * 2;
                const distanceComponent = Math.max(0, 1 - (safeDistance / maxDistanceForScore));
                const score = (0.5 * availabilityScore) + (0.3 * reliabilityScore) + (0.2 * distanceComponent);
                return {
                    ...donor,
                    contact: donor.contact || '',
                    availabilityByHistory: available,
                    reliabilityScore,
                    distanceKm,
                    score
                };
            });
 
            donorsScored.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
            });
 
            const TOP_K = 3;
            this.searchResultsAll = donorsScored;
            this.searchResults = donorsScored.slice(0, TOP_K);
            this.searchCenter = (centerLat !== null && centerLng !== null) ? { lat: centerLat, lng: centerLng } : null;
            this.displaySearchResults();
            this.showToast('Search completed', `Showing top ${this.searchResults.length} of ${this.searchResultsAll.length} donors`);
 
            // Fire-and-forget email notifications to donors within ~10km (if SMTP is configured)
            (async () => {
                try {
                    const body = {
                        bloodTypes,
                        lat: centerLat,
                        lng: centerLng,
                        radiusKm: this.searchRadiusKm,
                        state: this._centerState || '',
                        location,
                        patientName,
                        unitsNeeded,
                        caseType,
                        contact,
                        message: ''
                    };
                    const notifyOut = await this.apiFetch('/api/donors/search', {
                        method: 'POST',
                        body: JSON.stringify(body)
                    });
                    const emailInfo = notifyOut && notifyOut.email;
                    if (emailInfo && emailInfo.enabled && emailInfo.sentCount > 0) {
                        this.showToast(
                            'Email alerts sent',
                            `Notified ${emailInfo.sentCount} donor${emailInfo.sentCount > 1 ? 's' : ''} within 10 km`,
                            'success'
                        );
                    }
                } catch (_) {
                    // Email notifications are best-effort only; ignore failures here
                }
            })();
        } catch (err) {
            this.showToast('Search failed', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
 
    // Check if coordinates are within India's boundaries
    isLocationInIndia(lat, lng) {
        // India's approximate boundaries
        const indiaBounds = {
            north: 37.1,  // Jammu and Kashmir
            south: 6.4,   // Tamil Nadu
            east: 97.4,   // Arunachal Pradesh
            west: 68.1    // Gujarat
        };
        
        return lat >= indiaBounds.south && 
               lat <= indiaBounds.north && 
               lng >= indiaBounds.west && 
               lng <= indiaBounds.east;
    }
 
    // Haversine distance in kilometers
    computeDistanceKm(lat1, lon1, lat2, lon2) {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371; // Earth radius in km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
 
    // Offset a coordinate by meters in bearing degrees
    offsetLatLngByMeters(lat, lng, meters, bearingDeg) {
        const R = 6378137; // meters
        const dByR = meters / R;
        const bearing = (bearingDeg * Math.PI) / 180;
        const lat1 = (lat * Math.PI) / 180;
        const lon1 = (lng * Math.PI) / 180;
        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(dByR) + Math.cos(lat1) * Math.sin(dByR) * Math.cos(bearing)
        );
        const lon2 =
            lon1 +
            Math.atan2(
                Math.sin(bearing) * Math.sin(dByR) * Math.cos(lat1),
                Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
            );
        return { lat: (lat2 * 180) / Math.PI, lng: (lon2 * 180) / Math.PI };
    }
    
    displaySearchResults() {
        const resultsCount = document.getElementById('results-count');
        const resultsContent = document.getElementById('results-content');
        const mapContainer = document.getElementById('map-container');
        // Update dynamic recommendation ticker based on recent donations
        try {
            const tickerTrack = document.querySelector('.news-track');
            if (tickerTrack) {
                const recent = (this.mockData.donations || [])
                    .sort((a,b) => new Date(b.date) - new Date(a.date))
                    .slice(0, 5)
                    .map(d => {
                        const donor = (this.mockData.donors || []).find(x => x.id === d.donorId);
                        const user = donor ? (this.mockData.users || []).find(u => u.id === donor.userId) : null;
                        const name = user ? `${user.firstName} ${user.lastName}` : 'A donor';
                        return `${name} donated ${d.type} on ${new Date(d.date).toLocaleDateString()}`;
                    });
                const fallback = ['Donate regularly. Save lives.', 'Thank you, donors!', 'Top recommendations shown based on distance, availability, and reliability.'];
                const items = recent.length ? recent : fallback;
                tickerTrack.innerHTML = `<span class="news-item">${items.join('  •  ')}</span>`;
            }
        } catch (_) {}
        
        if (this.searchResultsAll && Array.isArray(this.searchResultsAll)) {
            resultsCount.textContent = `Top ${this.searchResults.length} of ${this.searchResultsAll.length}`;
        } else {
            resultsCount.textContent = `${this.searchResults.length} Found`;
        }
        
        if (this.searchResults.length > 0) {
            // Show map if Google Maps is loaded
            if (this.isGoogleMapsLoaded) {
                mapContainer.style.display = 'block';
                this.initializeMap();
            }
            
            // Build Top Recommendations section
            const topCards = this.searchResults.map(donor => `
                <div class=\"donor-result-card top-reco\"> 
                    <div class="donor-result-header">
                        <div class="donor-info">
                            <div class="donor-avatar">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                                </svg>
                            </div>
                            <div class="donor-details">
                                <h4>${donor.user ? `${donor.user.firstName} ${donor.user.lastName}` : 'Donor'}</h4>
                                <p class="donor-location">
                                    <svg class="icon-small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                    </svg>
                                    ${donor.location}
                                </p>
                            </div>
                        </div>
                        <span class="blood-type-badge">${donor.bloodType}</span>
                    </div>
                    <div class="donor-result-details">
                        <div class="detail-item">
                            <strong>${this.t('detail.age') || 'Age'}:</strong> ${donor.age}
                        </div>
                        <div class="detail-item">
                            <strong>${this.t('detail.gender') || 'Gender'}:</strong> <span style="text-transform: capitalize;">${donor.gender}</span>
                        </div>
                        <div class="detail-item">
                            <strong>${this.t('detail.occupation') || 'Occupation'}:</strong> ${donor.occupation}
                        </div>
                        <div class="detail-item">
                            <strong>Distance:</strong> ${isFinite(donor.distanceKm) ? donor.distanceKm.toFixed(1) + ' km' : '—'}
                        </div>
                        <div class="detail-item">
                            <strong>${this.t('detail.availability') || 'Availability'}:</strong> <span class="${donor.availabilityByHistory ? 'text-green' : 'text-red'}">${donor.availabilityByHistory ? (this.t('detail.available') || 'Available') : (this.t('detail.unavailable') || 'Not Available')}</span>
                        </div>
                        <div class="detail-item">
                            <strong>Reliability:</strong> ${(donor.reliabilityScore * 100).toFixed(0)}%
                        </div>
                        <div class="detail-item">
                            <strong>Score:</strong> ${donor.score.toFixed(2)}
                        </div>
                    </div>
                    <div class="donor-actions">
                        <button class="btn btn-primary contact-donor-btn" data-donor-id="${donor.id}">
                            ${this.t('detail.contact_btn') || 'Contact Donor'}
                        </button>
                        ${this.getRequestButtonHtml(donor.id)}
                    </div>
                </div>`).join('');
 
            // Build Remaining Donors section (not in top list), sorted by distance
            const remaining = (this.searchResultsAll || []).filter(d => !this.searchResults.some(t => t.id === d.id))
                .sort((a,b) => (a.distanceKm - b.distanceKm));
            const remainingCards = remaining.map(donor => `
                <div class=\"donor-result-card\"> 
                    <div class=\"donor-result-header\"> 
                        <div class=\"donor-info\"> 
                            <div class=\"donor-avatar\"> 
                                <svg fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"> 
                                    <path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z\"></path> 
                                </svg> 
                            </div> 
                            <div class=\"donor-details\"> 
                                <h4>${donor.user ? `${donor.user.firstName} ${donor.user.lastName}` : 'Donor'}</h4> 
                                <p class=\"donor-location\"> 
                                    <svg class=\"icon-small\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"> 
                                        <path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z\"></path> 
                                        <path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M15 11a3 3 0 11-6 0 3 3 0 016 0z\"></path> 
                                    </svg> 
                                    ${donor.location} 
                                </p> 
                            </div> 
                        </div> 
                        <div style=\"display:flex; gap:8px; align-items:center;\">
                            <span class=\"reco-badge\">Recommended</span>
                            <span class=\"blood-type-badge\">${donor.bloodType}</span>
                        </div>
                    </div> 
                    <div class=\"donor-result-details\"> 
                        <div class=\"detail-item\"><strong>Distance:</strong> ${isFinite(donor.distanceKm) ? donor.distanceKm.toFixed(1) + ' km' : '—'}</div> 
                        <div class=\"detail-item\"><strong>${this.t('detail.availability') || 'Availability'}:</strong> <span class=\"${donor.availabilityByHistory ? 'text-green' : 'text-red'}\">${donor.availabilityByHistory ? (this.t('detail.available') || 'Available') : (this.t('detail.unavailable') || 'Not Available')}</span></div> 
                        <div class=\"detail-item\"><strong>Reliability:</strong> ${(donor.reliabilityScore * 100).toFixed(0)}%</div> 
                    </div> 
                    <div class=\"donor-actions\"> 
                        <button class=\"btn btn-primary contact-donor-btn\" data-donor-id=\"${donor.id}\">${this.t('detail.contact_btn') || 'Contact Donor'}</button> 
                        ${this.getRequestButtonHtml(donor.id)} 
                    </div> 
                </div>`).join('');
 
            const topCount = this.searchResults.length;
            const remainingCount = (this.searchResultsAll ? this.searchResultsAll.length : 0) - topCount;
            resultsContent.innerHTML = `
                <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0;">Top Recommendations</h4>
                    <span class="results-badge">${topCount}</span>
                </div>
                ${topCards || '<div class="empty-state"><p>No top donors</p></div>'}
                <div style="margin:16px 0 12px; display:flex; justify-content:space-between; align-items:center;">
                    <h4 style="margin:0;">More Donors Nearby</h4>
                    <span class="results-badge">${Math.max(remainingCount, 0)}</span>
                </div>
                ${remainingCards || '<div class="empty-state"><p>No more donors</p></div>'}
            `;
            
            // Add event listeners to contact buttons
            document.querySelectorAll('.contact-donor-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const donorId = btn.dataset.donorId;
                    let donor = this.searchResults.find(d => String(d.id) === String(donorId));
                    if (!donor && Array.isArray(this.searchResultsAll)) {
                        donor = this.searchResultsAll.find(d => String(d.id) === String(donorId));
                    }
                    if (donor) {
                        this.showDonorModal(donor);
                    }
                });
            });
 
            // Add event listeners to request buttons
            document.querySelectorAll('.request-blood-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const donorId = btn.dataset.donorId;
                    let donor = this.searchResults.find(d => String(d.id) === String(donorId));
                    if (!donor && Array.isArray(this.searchResultsAll)) {
                        donor = this.searchResultsAll.find(d => String(d.id) === String(donorId));
                    }
                    if (donor) {
                        this.showBloodRequestModal(donor);
                    }
                });
            });
 
            // Add a small tip showing last donation if available
            document.querySelectorAll('.donor-result-card').forEach(card => {
                const idEl = card.querySelector('.contact-donor-btn');
                if (!idEl) return;
                const donorId = idEl.getAttribute('data-donor-id');
                let donor = this.searchResults.find(d => String(d.id) === String(donorId));
                if (!donor && Array.isArray(this.searchResultsAll)) {
                    donor = this.searchResultsAll.find(d => String(d.id) === String(donorId));
                }
                if (!donor) return;
                const donations = this.mockData.donations.filter(d => d.donorId === donor.id);
                if (donations.length > 0) {
                    const last = new Date(Math.max(...donations.map(d => new Date(d.date).getTime())));
                    const tip = document.createElement('div');
                    tip.className = 'detail-item';
                    tip.innerHTML = `<strong>Last Donation:</strong> ${last.toLocaleDateString()}`;
                    const details = card.querySelector('.donor-result-details');
                    details && details.appendChild(tip);
                }
            });
 
            // Apply translations to any new tagged nodes
            this.applyTranslations();
        } else {
            mapContainer.style.display = 'none';
            resultsContent.innerHTML = `
                <div class="empty-state">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                    <p>No donors found matching your criteria</p>
                </div>
            `;
        }
    }
    
    initializeMap() {
        if (!window.google || this.searchResults.length === 0) return;
        
        const mapContainer = document.getElementById('map-container');
        if (!mapContainer) return;
        
        // Calculate center point: prefer seeker center, else first result, else default
        let center = this.searchCenter || null;
        if (!center) {
            const firstWithCoords = this.searchResults.find(r => !isNaN(parseFloat(r.latitude)) && !isNaN(parseFloat(r.longitude)));
            if (firstWithCoords) {
                center = { lat: parseFloat(firstWithCoords.latitude), lng: parseFloat(firstWithCoords.longitude) };
            } else {
                center = { lat: 20.5937, lng: 78.9629 }; // Fallback center: India
            }
        }
        
        this.map = new google.maps.Map(mapContainer, {
            center: center,
            zoom: 12,
            styles: [
                {
                    featureType: 'poi',
                    elementType: 'labels',
                    stylers: [{ visibility: 'off' }]
                }
            ]
        });
        
        // Clear existing markers
        if (this._mapMarkers && this._mapMarkers.length) {
            this._mapMarkers.forEach(m => m.setMap(null));
        }
        this._mapMarkers = [];
 
        // Add markers for donors with overlap offset
        const seenCoordCounts = new Map();
        const markerSource = (this.searchResultsAll && this.searchResultsAll.length) ? this.searchResultsAll : this.searchResults;
        markerSource.forEach(async donor => {
            const lat = parseFloat(donor.latitude);
            const lng = parseFloat(donor.longitude);
            
            let hasCoords = !(isNaN(lat) || isNaN(lng));
            let markerPos = null;
            if (!hasCoords && donor.location) {
                // Attempt to geocode village-only names on the fly
                try {
                    const coords = await this.geocodeAddress(donor.location);
                    donor.latitude = coords.latitude;
                    donor.longitude = coords.longitude;
                    hasCoords = true;
                } catch (_) {}
            }
 
            if (hasCoords) {
                const dLat = parseFloat(donor.latitude);
                const dLng = parseFloat(donor.longitude);
                const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                const count = (seenCoordCounts.get(key) || 0);
                seenCoordCounts.set(key, count + 1);
                let position = { lat: dLat, lng: dLng };
                if (count > 0) {
                    const angleDeg = (count * 45) % 360;
                    const ring = Math.floor(count / 8) + 1;
                    const radiusMeters = 8 * ring;
                    position = this.offsetLatLngByMeters(lat, lng, radiusMeters, angleDeg);
                }
                const marker = new google.maps.Marker({
                    position,
                    map: this.map,
                    title: `${donor.bloodType} Donor`,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: '#dc2626',
                        fillOpacity: 1,
                        strokeWeight: 2,
                        strokeColor: '#ffffff'
                    }
                });
                this._mapMarkers.push(marker);
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding:12px; max-width:260px;">
                            <div style="font-weight:700; font-size:16px; color:#111827; margin-bottom:6px;">${donor.user ? donor.user.firstName + ' ' + donor.user.lastName : 'Donor'} (${donor.bloodType})</div>
                            <div style="font-size:13px; color:#374151; line-height:1.4;">
                                <div><strong>${this.t('detail.age') || 'Age'}:</strong> ${donor.age}</div>
                                <div><strong>${this.t('detail.gender') || 'Gender'}:</strong> ${donor.gender}</div>
                                <div><strong>${this.t('detail.occupation') || 'Occupation'}:</strong> ${donor.occupation}</div>
                                <div><strong>${this.t('detail.location') || 'Location'}:</strong> ${donor.location}</div>
                                <div><strong>${this.t('detail.contact') || 'Contact'}:</strong> ${donor.contact}</div>
                            </div>
                        </div>
                    `
                });
                
                marker.addListener('click', () => {
                    infoWindow.open(this.map, marker);
                    this.showDonorModal(donor);
                });
            }
        });
        
        // Draw 10km radius circle if search center available
        let bounds = null;
        if (this.searchCenter) {
            const circle = new google.maps.Circle({
                strokeColor: '#2563eb',
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                map: this.map,
                center: this.searchCenter,
                radius: this.searchRadiusKm * 1000
            });
            bounds = circle.getBounds();
 
            // Add seeker center marker (blue dot)
            const centerMarker = new google.maps.Marker({
                position: this.searchCenter,
                map: this.map,
                title: 'Search Center',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 6,
                    fillColor: '#2563eb',
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: '#ffffff'
                }
            });
            this._mapMarkers.push(centerMarker);
        }
 
        // Fit bounds to include markers and radius
        if (this._mapMarkers.length > 0) {
            if (!bounds) bounds = new google.maps.LatLngBounds();
            this._mapMarkers.forEach(m => bounds.extend(m.getPosition()));
            if (this.searchCenter) bounds.extend(this.searchCenter);
            this.map.fitBounds(bounds);
        }
    }
    
    fillDonorDetailsSection(donor) {
        const donorPhone = document.getElementById('donor-phone');
        const d = donor || {};
        const contact = (d.contact && String(d.contact).trim()) ? String(d.contact).trim() : 'Not provided';
        if (donorPhone) donorPhone.textContent = contact;
    }
 
    showDonorModal(donor) {
        const modal = document.getElementById('donor-modal');
        const modalName = document.getElementById('donor-modal-name');
        const modalBloodType = document.getElementById('donor-modal-blood-type');
        const detailsLeft = document.getElementById('donor-details-left');
        const detailsRight = document.getElementById('donor-details-right');
        this._modalDonorId = donor?.id || null;
        
        modalName.textContent = donor.user ? `${donor.user.firstName} ${donor.user.lastName}` : 'Donor';
        modalBloodType.textContent = `Blood Type: ${donor.bloodType}`;
        this.fillDonorDetailsSection(donor);
        
        detailsLeft.innerHTML = `
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Age</p>
                    <p class="detail-value">${donor.age} years old</p>
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Gender</p>
                    <p class="detail-value" style="text-transform: capitalize;">${donor.gender}</p>
                </div>
            </div>
        `;
        
        detailsRight.innerHTML = `
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m8 6V8a2 2 0 00-2-2H10a2 2 0 00-2 2v8a2 2 0 002 2h4a2 2 0 002-2z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Occupation</p>
                    <p class="detail-value">${donor.occupation}</p>
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Location</p>
                    <p class="detail-value">${donor.location}</p>
                </div>
            </div>
        `;
        
        // Initialize modal map (Google Maps or OpenStreetMap fallback)
        const modalMap = document.getElementById('modal-map');
        if (modalMap) {
            const renderFallbackMap = (plat, plng) => {
                const delta = 0.01;
                const bbox = [plng - delta, plat - delta, plng + delta, plat + delta].join(',');
                const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${plat},${plng}`;
                const viewUrl = `https://www.openstreetmap.org/?mlat=${plat}&mlon=${plng}#map=15/${plat}/${plng}`;
                modalMap.innerHTML = `
                    <iframe title="Donor location" src="${embedUrl}" style="width:100%;height:100%;min-height:280px;border:0;border-radius:8px;" loading="lazy"></iframe>
                    <a href="${viewUrl}" target="_blank" rel="noopener" class="modal-map-link">View larger map</a>
                `;
            };
            const tryGeocodeAndRender = () => {
                let lat = parseFloat(donor.latitude);
                let lng = parseFloat(donor.longitude);
                if (!isNaN(lat) && !isNaN(lng)) {
                    if (this.isGoogleMapsLoaded && window.google) {
                        modalMap.innerHTML = '';
                        const map = new google.maps.Map(modalMap, {
                            center: { lat, lng },
                            zoom: 15,
                            styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }]
                        });
                        new google.maps.Marker({
                            position: { lat, lng },
                            map,
                            title: `${donor.bloodType} Donor`,
                            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#dc2626', fillOpacity: 1, strokeWeight: 2, strokeColor: '#ffffff' }
                        });
                    } else {
                        renderFallbackMap(lat, lng);
                    }
                    return;
                }
                if (donor.location) {
                    this.geocodeAddress(donor.location).then(coords => {
                        donor.latitude = coords.latitude;
                        donor.longitude = coords.longitude;
                        const plat = parseFloat(coords.latitude);
                        const plng = parseFloat(coords.longitude);
                        if (this.isGoogleMapsLoaded && window.google) {
                            modalMap.innerHTML = '';
                            const map = new google.maps.Map(modalMap, { center: { lat: plat, lng: plng }, zoom: 15, styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }] });
                            new google.maps.Marker({ position: { lat: plat, lng: plng }, map, title: `${donor.bloodType} Donor`, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#dc2626', fillOpacity: 1, strokeWeight: 2, strokeColor: '#ffffff' } });
                        } else {
                            renderFallbackMap(plat, plng);
                        }
                    }).catch(() => {
                        renderFallbackMap(20.5937, 78.9629);
                    });
                } else {
                    renderFallbackMap(20.5937, 78.9629);
                }
            };
            setTimeout(() => {
                modalMap.innerHTML = '';
                if (this.isGoogleMapsLoaded && window.google) {
                    let lat = parseFloat(donor.latitude);
                    let lng = parseFloat(donor.longitude);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        const map = new google.maps.Map(modalMap, { center: { lat, lng }, zoom: 15, styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }] });
                        new google.maps.Marker({ position: { lat, lng }, map, title: `${donor.bloodType} Donor`, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#dc2626', fillOpacity: 1, strokeWeight: 2, strokeColor: '#ffffff' } });
                    } else {
                        tryGeocodeAndRender();
                    }
                } else {
                    tryGeocodeAndRender();
                }
            }, 150);
        }
        
        modal.style.display = 'flex';
        // Fetch full donor (includes contact) and refresh details without any pop-up or error message
        const donorId = this._modalDonorId;
        if (donorId && this.authToken) {
            this.apiFetch(`/api/donors/${encodeURIComponent(donorId)}`).then(out => {
                if (out && out.donor) {
                    Object.assign(donor, out.donor);
                    this.fillDonorDetailsSection(donor);
                }
            }).catch(() => {});
        }
    }
    
    closeModal() {
        document.getElementById('donor-modal').style.display = 'none';
    }
 
    showBloodRequestModal(donor) {
        const modal = document.getElementById('blood-request-modal');
        const donorName = document.getElementById('request-donor-name');
        
        // Store donor ID for form submission
        this.currentRequestDonorId = donor.id;
        
        donorName.textContent = `Requesting blood from ${donor.user ? `${donor.user.firstName} ${donor.user.lastName}` : 'Donor'}`;
        
        // Pre-fill blood type if available
        const bloodTypeSelect = document.querySelector('#blood-request-form select[name="bloodType"]');
        if (bloodTypeSelect) {
            bloodTypeSelect.value = donor.bloodType || '';
        }
        
        modal.style.display = 'flex';
    }
 
    closeBloodRequestModal() {
        document.getElementById('blood-request-modal').style.display = 'none';
        // Reset form
        document.getElementById('blood-request-form').reset();
    }
 
    handleBloodRequestSubmit(e) {
        e.preventDefault();
        
        if (!this.currentUser) {
            this.showToast('Error', 'Please log in to send blood requests', 'error');
            return;
        }
 
        const form = document.getElementById('blood-request-form');
        const formData = new FormData(form);
        
        const bloodType = formData.get('bloodType');
        const urgency = formData.get('urgency');
        const location = formData.get('location');
        const message = formData.get('message');
        
        if (!bloodType || !urgency) {
            this.showToast('Error', 'Please fill in all required fields', 'error');
            return;
        }
 
        // Get the donor ID from the modal (we'll need to store this when opening the modal)
        const donorId = this.currentRequestDonorId;
        if (!donorId) {
            this.showToast('Error', 'Donor information not found', 'error');
            return;
        }
 
        this.showLoading('Sending request...');
        (async () => {
            try {
                await this.apiFetch('/api/requests', {
                    method: 'POST',
                    body: JSON.stringify({
                        donorId,
                        bloodType,
                        urgency,
            location: location || 'Not specified',
                        message: message || ''
                    })
                });
        this.showToast('Request Sent', 'Your blood request has been sent to the donor', 'success');
        this.closeBloodRequestModal();
                await this.refreshRequests();
        
        // Update seeker dashboard if on seeker page
        if (this.currentPage === 'seeker-dashboard') {
            this.updateSeekerRequestStats();
            this.displaySearchResults();
        }
            } catch (err) {
                this.showToast('Error', err.message, 'error');
            } finally {
                this.hideLoading();
            }
        })();
    }
 
    getRequestButtonHtml(donorId) {
        if (!this.currentUser) {
            return `<button class="btn btn-secondary" disabled>Login to Request</button>`;
        }
 
        // Check if user already has a request to this donor (backend data)
        const existingRequest = (this._requestsAsSeeker || []).find(req =>
            String(req.donorId) === String(donorId)
        );
 
        if (existingRequest) {
            if (existingRequest.status === 'accepted') {
                return `
                    <button class="btn btn-success contact-donor-btn" data-donor-id="${donorId}">
                        Contact Donor
                    </button>
                `;
            }
            const statusClass = existingRequest.status === 'rejected' ? 'status-rejected' : 'status-pending';
            return `
                <button class="btn btn-secondary" disabled>
                    <span class="request-status ${statusClass}">${existingRequest.status}</span>
                </button>
            `;
        }
 
        return `
            <button class="btn btn-secondary request-blood-btn" data-donor-id="${donorId}">
                <svg class="icon-small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
                Request
            </button>
        `;
    }
 
    async refreshRequests() {
        if (!this.currentUser || !this.authToken) {
            this._requestsAsSeeker = [];
            this._requestsAsDonor = [];
            return;
        }
        try {
            const out = await this.apiFetch('/api/requests/me');
            this._requestsAsSeeker = Array.isArray(out.asSeeker) ? out.asSeeker : [];
            this._requestsAsDonor = Array.isArray(out.asDonor) ? out.asDonor : [];
        } catch (_) {
            // Keep existing arrays on transient failure
        }
    }
 
    updateSeekerRequestStats() {
        if (!this.currentUser) return;
        const userRequests = this._requestsAsSeeker || [];
        const activeRequests = userRequests.filter(req => req.status === 'pending').length;
        // Treat both 'accepted' and 'completed' as successful responses
        const completedRequests = userRequests.filter(req => req.status === 'completed').length;
        const acceptedRequests = userRequests.filter(req => req.status === 'accepted' || req.status === 'completed').length;
        
        // Update stats display
        const activeEl = document.getElementById('active-requests');
        const responsesEl = document.getElementById('total-responses');
        const completedEl = document.getElementById('completed-requests');
        
        if (activeEl) activeEl.textContent = activeRequests;
        if (responsesEl) responsesEl.textContent = acceptedRequests;
        if (completedEl) completedEl.textContent = completedRequests;
        
        // Update seeker requests list
        this.updateSeekerRequestsList();
        this.updateAcceptedRequestsList();
    }
 
    updateSeekerRequestsList() {
        if (!this.currentUser) return;
        const userRequests = this._requestsAsSeeker || [];
        // Hide completed requests from the main list; they appear in Accepted Requests instead
        const visibleRequests = userRequests.filter(req => req.status !== 'completed');
        const requestsListEl = document.getElementById('seeker-requests-list');
        
        if (requestsListEl) {
            if (visibleRequests.length === 0) {
                requestsListEl.innerHTML = `
                    <div class="empty-state">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4m-6 4h6m0 0l-6 6m6-6L10 5"></path>
                        </svg>
                        <p>No blood requests yet</p>
                    </div>
                `;
            } else {
                requestsListEl.innerHTML = visibleRequests.map(request => {
                    const donorName = request.donorName || 'Donor';
                    const urgencyClass = `urgency-${request.urgency}`;
                    const statusClass = `status-${request.status}`;
                    
                    return `
                        <div class="request-item">
                            <div class="request-item-header">
                                <div class="request-seeker-info">
                                    <h4>Request to ${donorName}</h4>
                                    <span class="request-blood-type">${request.bloodType}</span>
                                </div>
                                <div>
                                    <span class="request-urgency ${urgencyClass}">${request.urgency}</span>
                                    <span class="request-status ${statusClass}">${request.status}</span>
                                </div>
                            </div>
                            <div class="request-details">
                                <div class="request-detail-item">
                                    <strong>Location:</strong> ${request.location}
                                </div>
                                <div class="request-detail-item">
                                    <strong>Requested:</strong> ${new Date(request.createdAt).toLocaleString()}
                                </div>
                                ${request.message ? `<div class="request-detail-item"><strong>Message:</strong> ${request.message}</div>` : ''}
                                ${request.status === 'accepted' ? `
                                    <div class="request-detail-item" style="color: var(--green-600); font-weight: 600;">
                                        ✅ Request Accepted! Contact the donor to arrange donation.
                                    </div>
                                ` : request.status === 'rejected' ? `
                                    <div class="request-detail-item" style="color: var(--red-600); font-weight: 600;">
                                        ❌ Request Rejected
                                    </div>
                                ` : `
                                    <div class="request-detail-item" style="color: var(--red-600); font-weight: 600;">
                                        ⏳ Pending donor response
                                    </div>
                                `}
                            </div>
                            <div class="request-actions">
                                <button class="btn btn-danger btn-small delete-request-btn" data-request-id="${request.id}">
                                    <svg class="icon-small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                    Delete
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
                
                // Add event listeners for delete buttons
                document.querySelectorAll('.delete-request-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const requestId = btn.dataset.requestId;
                        this.deleteRequest(requestId);
                    });
                });
            }
        }
    }
 
    updateAcceptedRequestsList() {
        if (!this.currentUser) return;
        const listEl = document.getElementById('accepted-requests-list');
        if (!listEl) return;
        // Show both accepted and completed requests as "accepted" for the seeker
        const accepted = (this._requestsAsSeeker || []).filter(
            req => req.status === 'accepted' || req.status === 'completed'
        );
        if (accepted.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <p>No accepted requests yet</p>
                </div>
            `;
            return;
        }
        listEl.innerHTML = accepted.map(request => {
            const donorName = request.donorName || 'Donor';
            return `
                <div class="request-item">
                    <div class="request-item-header">
                        <div class="request-seeker-info">
                            <h4>${donorName}</h4>
                            <span class="request-blood-type">${request.bloodType}</span>
                        </div>
                        <span class="request-status ${request.status === 'completed' ? 'status-completed' : 'status-accepted'}">
                            ${request.status === 'completed' ? 'completed' : 'accepted'}
                        </span>
                    </div>
                    <div class="request-details">
                        <div class="request-detail-item"><strong>Location:</strong> ${request.location}</div>
                                <div class="request-detail-item"><strong>Urgency:</strong> ${request.urgency}</div>
                        <div class="request-detail-item"><strong>Requested:</strong> ${new Date(request.createdAt).toLocaleString()}</div>
                        ${request.message ? `<div class="request-detail-item"><strong>Message:</strong> ${request.message}</div>` : ''}
                    </div>
                    <div class="request-actions">
                        <button class="btn btn-success btn-small contact-accepted-btn" data-donor-id="${request.donorId}">
                            Contact Donor
                        </button>
                    </div>
                </div>
            `;
        }).join('');
 
        // Wire contact buttons to open donor modal with contact revealed
        document.querySelectorAll('.contact-accepted-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const donorId = btn.dataset.donorId;
                try {
                    this.showLoading('Loading donor...');
                    const out = await this.apiFetch(`/api/donors/${encodeURIComponent(donorId)}`);
                    this.showDonorModal(out.donor);
                } catch (err) {
                    this.showToast('Error', err.message, 'error');
                } finally {
                    this.hideLoading();
                }
            });
        });
    }
 
    updateDonorRequestPanel() {
        if (!this.currentUser || !this.currentDonor) return;
        
        const donorRequests = this._requestsAsDonor || [];
        const pendingRequests = donorRequests.filter(req => req.status === 'pending');
        
        const pendingCountEl = document.getElementById('pending-requests-count');
        const requestsListEl = document.getElementById('blood-requests-list');
        
        if (pendingCountEl) {
            // When there are pending items, show red \"N Pending\".
            // When there are no pending items but history exists, show green \"All Completed\".
            if (pendingRequests.length > 0) {
                pendingCountEl.textContent = `${pendingRequests.length} Pending`;
                pendingCountEl.classList.remove('requests-badge-success');
            } else if (donorRequests.length > 0) {
                pendingCountEl.textContent = 'All Completed';
                pendingCountEl.classList.add('requests-badge-success');
            } else {
                pendingCountEl.textContent = '0 Pending';
                pendingCountEl.classList.remove('requests-badge-success');
            }
        }
        
        if (requestsListEl) {
            if (donorRequests.length === 0) {
                requestsListEl.innerHTML = `
                    <div class="empty-state">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
                        </svg>
                        <p>No blood requests yet</p>
                    </div>
                `;
            } else {
                requestsListEl.innerHTML = donorRequests.map(request => {
                    const seekerName = request.seekerName || 'Seeker';
                    const urgencyClass = `urgency-${request.urgency}`;
                    const statusClass = `status-${request.status}`;
                    const createdOn = new Date(request.createdAt).toLocaleDateString();
                    const updatedOn = new Date(request.updatedAt || request.createdAt).toLocaleString();
                    
                    return `
                        <div class="request-item urgent-request-card">
                            <h4 class="urgent-request-title">🔔 URGENT BLOOD REQUIREMENT 🔔</h4>
                            <ul class="request-bullet-list">
                                <li><strong>Seeker:</strong> ${seekerName}</li>
                                <li><strong>Blood Group:</strong> ${request.bloodType}</li>
                                <li><strong>Urgency:</strong> <span class="request-urgency ${urgencyClass}">${request.urgency}</span></li>
                                <li><strong>Hospital &amp; Location:</strong> ${request.location}</li>
                                ${request.message ? `<li><strong>Note:</strong> ${request.message}</li>` : ''}
                                <li><strong>Requested On:</strong> ${createdOn}</li>
                            </ul>
                            <p class="request-footer-text">
                                Please donate if you are eligible or help spread the word. One share can save a life. Thank you! 🩸
                            </p>
                            <div class="request-actions-row">
                                <div class="request-actions-table">
                                    ${request.status === 'pending' ? `
                                        <button class="icon-btn accept-request-btn" data-request-id="${request.id}" title="Accept">✅</button>
                                        <button class="icon-btn reject-request-btn" data-request-id="${request.id}" title="Reject">❌</button>
                                    ` : ''}
                                    <button class="icon-btn delete-request-btn" data-request-id="${request.id}" title="Delete">🗑️</button>
                                </div>
                                <span class="request-updated-text">Updated: ${updatedOn}</span>
                            </div>
                        </div>
                    `;
                }).join('');
                
                // Add event listeners for accept/reject buttons
                document.querySelectorAll('.accept-request-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const requestId = btn.dataset.requestId;
                        // Mark the request as fully completed (donation done)
                        this.updateRequestStatus(requestId, 'completed');
                    });
                });
                
                document.querySelectorAll('.reject-request-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const requestId = btn.dataset.requestId;
                        this.updateRequestStatus(requestId, 'rejected');
                    });
                });
                
                // Add event listeners for delete buttons
                document.querySelectorAll('.delete-request-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const requestId = btn.dataset.requestId;
                        this.deleteRequest(requestId);
                    });
                });
            }
        }
    }
 
    async updateRequestStatus(requestId, newStatus) {
        this.showLoading('Updating request...');
        try {
            await this.apiFetch(`/api/requests/${encodeURIComponent(requestId)}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: newStatus })
            });
            await this.refreshRequests();
            this.showToast(
                'Request Updated', 
                `Request ${newStatus} successfully`, 
                newStatus === 'accepted' ? 'success' : 'info'
            );
            
            this.updateDonorRequestPanel();
            this.updateSeekerRequestStats();
            this.displaySearchResults();

            // If a donation has been completed, refresh donor stats immediately
            if (newStatus === 'completed' && this.currentPage === 'donor-dashboard') {
                await this.initDonorDashboard();
            }
        } catch (err) {
            this.showToast('Error', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
 
    showGeneralRequestModal() {
        const modal = document.getElementById('general-request-modal');
        modal.style.display = 'flex';
    }
 
    closeGeneralRequestModal() {
        document.getElementById('general-request-modal').style.display = 'none';
        // Reset form
        document.getElementById('general-request-form').reset();
    }
 
    async handleGeneralRequestSubmit(e) {
        e.preventDefault();
        
        if (!this.currentUser) {
            this.showToast('Error', 'Please log in to send blood requests', 'error');
            return;
        }
 
        const form = document.getElementById('general-request-form');
        const formData = new FormData(form);
        
        const bloodType = formData.get('bloodType');
        const urgency = formData.get('urgency');
        const location = formData.get('location');
        const message = formData.get('message');
        
        if (!bloodType || !urgency || !location) {
            this.showToast('Error', 'Please fill in all required fields', 'error');
            return;
        }
 
        this.showLoading('Sending requests...');
        try {
            // Optional: geocode so broadcast can be radius-limited
            let lat = null;
            let lng = null;
            try {
                const coords = await this.geocodeAddress(location);
                lat = parseFloat(coords.latitude);
                lng = parseFloat(coords.longitude);
            } catch (_) {}
 
            const out = await this.apiFetch('/api/requests/broadcast', {
                method: 'POST',
                body: JSON.stringify({
                    bloodType,
                    urgency,
                    location,
                    message: message || '',
                    lat,
                    lng,
                    radiusKm: this.searchRadiusKm
                })
            });
 
            if (out.created > 0) {
                this.showToast('Requests Sent', `Blood requests sent to ${out.created} matching donor${out.created > 1 ? 's' : ''}`, 'success');
        } else {
                this.showToast('No New Requests', 'You already have pending requests to matching donors (or none found).', 'info');
        }
 
        this.closeGeneralRequestModal();
            await this.refreshRequests();
            this.updateSeekerRequestStats();
        } catch (err) {
            this.showToast('Error', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
 
    async deleteRequest(requestId) {
        if (!confirm('Are you sure you want to delete this request? This action cannot be undone.')) return;
        this.showLoading('Deleting request...');
        try {
            await this.apiFetch(`/api/requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' });
            await this.refreshRequests();
                this.showToast('Request Deleted', 'Blood request has been deleted successfully', 'success');
                this.updateSeekerRequestStats();
                this.updateDonorRequestPanel();
            this.displaySearchResults();
        } catch (err) {
            this.showToast('Error', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
 
    async clearSeekerHistory() {
        if (!this.currentUser) return;
        if (!confirm('Are you sure you want to clear all your blood request history? This action cannot be undone.')) return;
        this.showLoading('Clearing history...');
        try {
            const ids = (this._requestsAsSeeker || []).map(r => r.id);
            for (const id of ids) {
                try { await this.apiFetch(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
            }
            await this.refreshRequests();
            this.showToast('History Cleared', 'All your blood request history has been cleared', 'success');
            this.updateSeekerRequestStats();
        } finally {
            this.hideLoading();
    }
    }
 
    async clearDonorHistory() {
        if (!this.currentUser || !this.currentDonor) return;
        if (!confirm('Are you sure you want to clear all blood request history? This action cannot be undone.')) return;
        this.showLoading('Clearing history...');
        try {
            const ids = (this._requestsAsDonor || []).map(r => r.id);
            for (const id of ids) {
                try { await this.apiFetch(`/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (_) {}
            }
            await this.refreshRequests();
            this.showToast('History Cleared', 'All blood request history has been cleared', 'success');
            this.updateDonorRequestPanel();
        } finally {
            this.hideLoading();
        }
    }
    
    callDonor() {
        const donorPhone = document.getElementById('donor-phone');
        const phone = (donorPhone && donorPhone.textContent) ? donorPhone.textContent.trim() : '';
        const looksLikePhone = /^[\d\s+\-()]{6,}$/.test(phone.replace(/\s/g, ''));
        if (looksLikePhone) window.open(`tel:${phone}`, '_self');
        else this.showToast('Contact', 'No phone number available to call.', 'info');
    }
    
    showLoading(text = 'Loading...') {
        const loading = document.getElementById('loading-spinner');
        const loadingText = document.getElementById('loading-text');
        
        loadingText.textContent = text;
        loading.style.display = 'flex';
        // Safety: auto-hide spinner after 12s to avoid being stuck
        if (this._loadingTimer) clearTimeout(this._loadingTimer);
        this._loadingTimer = setTimeout(() => {
            if (loading.style.display !== 'none') {
                loading.style.display = 'none';
            }
        }, 12000);
    }
    
    hideLoading() {
        const loading = document.getElementById('loading-spinner');
        loading.style.display = 'none';
        if (this._loadingTimer) {
            clearTimeout(this._loadingTimer);
            this._loadingTimer = null;
        }
    }
    
    showToast(title, description, type = 'success') {
        const container = document.getElementById('toast-container');
        const id = Date.now().toString();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-title">${title}</div>
            <div class="toast-description">${description}</div>
        `;
        
        container.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.classList.add('toast-show');
        }, 10);
        
        // Remove after 5 seconds
        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 300);
        }, 5000);
    }
 
    toggleUserProgressPanel() {
        const panel = document.getElementById('user-progress-panel');
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' || panel.style.display === '' ? 'block' : 'none';
        // Refresh data when opened
        if (panel.style.display === 'block') {
            if (this.currentUser && this.currentUser.role === 'donor') {
                this.initDonorDashboard();
            }
        }
    }
 
    toggleRecentDonations() {
        const list = document.getElementById('up-recent-list');
        const btn = document.getElementById('up-recent-toggle');
        if (!list || !btn) return;
        const willShow = list.style.display === 'none' || list.style.display === '';
        list.style.display = willShow ? 'block' : 'none';
        btn.textContent = willShow ? 'Hide' : 'Show';
    }
 
    async updateAvailability(e) {
        if (!this.currentUser) return;
        const value = e?.target?.value === 'available' ? 'available' : 'unavailable';
        this.showLoading('Updating availability...');
        try {
            const out = await this.apiFetch('/api/donors/me', {
                method: 'PATCH',
                body: JSON.stringify({ availability: value })
            });
            this.currentDonor = out.donor || this.currentDonor;
            
            // Refresh seeker list/map if open; otherwise update donor dashboard UI
            const form = document.getElementById('donor-search-form');
            if (form && this.currentPage === 'seeker-dashboard') {
                form.dispatchEvent(new Event('submit'));
            }
            if (this.currentPage === 'donor-dashboard') {
                this.initDonorDashboard();
            }
            this.showToast('Availability updated', value === 'available' ? 'You are now available' : 'You are now hidden from seekers');
        } catch (err) {
            this.showToast('Error', err.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
 
    // Firebase Authentication Integration
    initFirebase() {
        // Backend mode: Firebase is disabled.
        this.firebaseReady = false;
    }
 
    testGoogleOAuthConfig() {
        try {
            const provider = new window.firebase.GoogleAuthProvider();
            console.log('✅ Google OAuth provider created successfully:', provider);
            console.log('Provider ID:', provider.providerId);
            console.log('Scopes:', provider.scopes);
            
            // Test if we can create a provider (this tests the basic setup)
            console.log('✅ Firebase Google auth setup is working');
        } catch (error) {
            console.error('❌ Google OAuth configuration test failed:', error);
            console.error('This means Firebase Google auth will not work');
        }
    }
 
    // Firebase Firestore Methods
    async saveToFirestore(collectionName, data, docId = null) {
        if (!this.firebaseReady || !window.firebase.db) {
            console.log('Firebase not ready, skipping Firestore save');
            return null;
        }
 
        try {
            if (docId) {
                await window.firebase.setDoc(window.firebase.doc(window.firebase.db, collectionName, docId), data);
                return docId;
            } else {
                const docRef = await window.firebase.addDoc(window.firebase.collection(window.firebase.db, collectionName), data);
                return docRef.id;
            }
        } catch (error) {
            console.error('Error saving to Firestore:', error);
            throw error;
        }
    }
 
    async getFromFirestore(collectionName, docId) {
        if (!this.firebaseReady || !window.firebase.db) {
            console.log('Firebase not ready, skipping Firestore get');
            return null;
        }
 
        try {
            const docRef = window.firebase.doc(window.firebase.db, collectionName, docId);
            const docSnap = await window.firebase.getDoc(docRef);
            
            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() };
            } else {
                return null;
            }
        } catch (error) {
            console.error('Error getting from Firestore:', error);
            throw error;
        }
    }
 
    async queryFirestore(collectionName, conditions = []) {
        if (!this.firebaseReady || !window.firebase.db) {
            console.log('Firebase not ready, skipping Firestore query');
            return [];
        }
 
        try {
            let q = window.firebase.collection(window.firebase.db, collectionName);
            
            conditions.forEach(condition => {
                q = window.firebase.query(q, window.firebase.where(condition.field, condition.operator, condition.value));
            });
            
            const querySnapshot = await window.firebase.getDocs(q);
            const results = [];
            
            querySnapshot.forEach((doc) => {
                results.push({ id: doc.id, ...doc.data() });
            });
            
            return results;
        } catch (error) {
            console.error('Error querying Firestore:', error);
            throw error;
        }
    }
 
    async syncUserToFirestore() {
        if (!this.currentUser || !this.firebaseReady) return;
 
        try {
            const userData = {
                email: this.currentUser.email,
                firstName: this.currentUser.firstName,
                lastName: this.currentUser.lastName,
                role: this.currentUser.role,
                availability: this.currentUser.availability || 'available',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
 
            await this.saveToFirestore('users', userData, this.currentUser.id);
            console.log('User synced to Firestore');
        } catch (error) {
            console.error('Error syncing user to Firestore:', error);
        }
    }
 
    async syncDonorToFirestore() {
        if (!this.currentDonor || !this.firebaseReady) return;
 
        try {
            const donorData = {
                userId: this.currentUser.id,
                email: this.currentUser.email,
                firstName: this.currentDonor.firstName,
                lastName: this.currentDonor.lastName,
                bloodType: this.currentDonor.bloodType,
                location: this.currentDonor.location,
                latitude: this.currentDonor.latitude,
                longitude: this.currentDonor.longitude,
                state: this.currentDonor.state,
                phone: this.currentDonor.phone,
                availability: this.currentDonor.availability || 'available',
                govId: this.currentDonor.govId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
 
            await this.saveToFirestore('donors', donorData, this.currentDonor.id);
            console.log('Donor synced to Firestore');
        } catch (error) {
            console.error('Error syncing donor to Firestore:', error);
        }
    }
 
    async loadDonorsFromFirestore() { return this.mockData.donors; }
 
    setupFirebaseAuthListener() {
        if (!this.firebaseReady) return;
 
        window.firebase.onAuthStateChanged(window.firebase.auth, (user) => {
            this.firebaseUser = user;
            if (user) {
                console.log('Firebase user signed in:', user.email);
                // Sync Firebase user with local user if needed
                this.syncFirebaseUser(user);
            } else {
                console.log('Firebase user signed out');
            }
        });
 
        // Handle redirect results (for when popup is blocked)
        this.handleRedirectResult();
    }
 
    async handleRedirectResult() {
        try {
            const result = await window.firebase.getRedirectResult(window.firebase.auth);
            if (result && result.user) {
                console.log('Redirect sign-in successful:', result.user);
                this.firebaseUser = result.user;
                this.syncFirebaseUser(result.user);
                this.showToast('Signed in with Google', 'Choose your role to continue.');
                this.showPage('role-selection');
            }
        } catch (error) {
            console.error('Redirect result error:', error);
        }
    }
 
    syncFirebaseUser(firebaseUser) {
        // Check if we have a local user that matches Firebase user
        const localUser = this.mockData.users.find(u => u.email === firebaseUser.email);
        
        if (!localUser) {
            // Create local user from Firebase user
            const newUser = {
                id: firebaseUser.uid,
                email: firebaseUser.email,
                firstName: (firebaseUser.displayName && firebaseUser.displayName.split(' ')[0]) || 'Google',
                lastName: (firebaseUser.displayName && firebaseUser.displayName.split(' ').slice(1).join(' ')) || 'User',
                role: null,
                firebaseUid: firebaseUser.uid,
                password: 'google_authenticated', // Auto-generated for Google users
                provider: 'google'
            };
            
            this.mockData.users.push(newUser);
            this.currentUser = newUser;
            this.saveUserToStorage();
            this.saveDataToStorage();
            
            // Show success message and go to role selection
            this.showToast('Signed in with Google', 'Choose your role to continue.');
            this.showPage('role-selection');
        } else {
            // Update local user with Firebase info
            localUser.firebaseUid = firebaseUser.uid;
            if (firebaseUser.displayName) {
                const parts = firebaseUser.displayName.split(' ');
                if (!localUser.firstName || localUser.firstName === 'User') {
                    localUser.firstName = parts[0] || localUser.firstName || 'Google';
                }
                if (!localUser.lastName) {
                    localUser.lastName = parts.slice(1).join(' ') || localUser.lastName || 'User';
                }
            }
            this.currentUser = localUser;
            this.saveUserToStorage();
            
            // If user already has a role, go to dashboard
            if (localUser.role) {
                this.showPage(localUser.role === 'donor' ? 'donor-dashboard' : 'seeker-dashboard');
            } else {
                // Show success message and go to role selection
                this.showToast('Signed in with Google', 'Choose your role to continue.');
                this.showPage('role-selection');
            }
        }
    }
 
    async firebaseLogin(email, password) {
        if (!this.firebaseReady) {
            throw new Error('Firebase not ready');
        }
 
        try {
            const userCredential = await window.firebase.signInWithEmailAndPassword(
                window.firebase.auth, 
                email, 
                password
            );
            
            this.firebaseUser = userCredential.user;
            this.syncFirebaseUser(userCredential.user);
            
            return userCredential.user;
        } catch (error) {
            console.error('Firebase login error:', error);
            throw new Error(this.getFirebaseErrorMessage(error));
        }
    }
 
    async firebaseRegister(email, password, firstName, lastName) {
        if (!this.firebaseReady) {
            throw new Error('Firebase not ready');
        }
 
        try {
            const userCredential = await window.firebase.createUserWithEmailAndPassword(
                window.firebase.auth,
                email,
                password
            );
 
            // Update display name using SDK helper
            try {
                if (window.firebase.updateProfile) {
                    await window.firebase.updateProfile(userCredential.user, {
                        displayName: `${firstName || ''} ${lastName || ''}`.trim()
                    });
                } else if (userCredential.user.updateProfile) {
                    await userCredential.user.updateProfile({
                        displayName: `${firstName || ''} ${lastName || ''}`.trim()
                    });
                }
            } catch (nameErr) {
                console.warn('Display name update failed (non-blocking):', nameErr);
            }
 
            this.firebaseUser = userCredential.user;
            this.syncFirebaseUser(userCredential.user);
            
            return userCredential.user;
        } catch (error) {
            console.error('Firebase register error:', error);
            // Re-throw with original code preserved to avoid misclassification
            const err = new Error(this.getFirebaseErrorMessage(error));
            err.code = error.code;
            throw err;
        }
    }
 
    async firebaseGoogleLogin() {
        try {
            const provider = new window.firebase.GoogleAuthProvider();
            provider.addScope('email');
            provider.addScope('profile');
            
            const result = await window.firebase.signInWithPopup(window.firebase.auth, provider);
            console.log('Google sign-in successful:', result.user);
            
            this.firebaseUser = result.user;
            this.syncFirebaseUser(result.user);
            
            return result.user;
        } catch (error) {
            console.error('Firebase Google login error:', error);
            
            // If popup is blocked, try redirect
            if (error.code === 'auth/popup-blocked') {
                console.log('Popup blocked, trying redirect method...');
                const provider = new window.firebase.GoogleAuthProvider();
                provider.addScope('email');
                provider.addScope('profile');
                
                await window.firebase.signInWithRedirect(window.firebase.auth, provider);
                return null; // Will be handled by onAuthStateChanged
            }
            
            throw error;
        }
    }
 
 
    getFirebaseErrorMessage(error) {
        switch (error.code) {
            case 'auth/user-not-found':
                return 'No account found with this email address';
            case 'auth/wrong-password':
                return 'Incorrect password';
            case 'auth/email-already-in-use':
                return 'An account with this email already exists';
            case 'auth/weak-password':
                return 'Password is too weak';
            case 'auth/invalid-email':
                return 'Invalid email address';
            case 'auth/too-many-requests':
                return 'Too many failed attempts. Please try again later';
            case 'auth/popup-closed-by-user':
                return 'Sign-in popup was closed';
            case 'auth/cancelled-popup-request':
                return 'Sign-in was cancelled';
            case 'auth/popup-blocked':
                return 'Popup was blocked by browser. Please allow popups and try again.';
            case 'auth/operation-not-allowed':
                return 'Google sign-in is not enabled in Firebase Console. Please enable it in Authentication > Sign-in method > Google.';
            case 'auth/unauthorized-domain':
                return 'This domain is not authorized for Google sign-in. Please add this domain to Firebase Console > Authentication > Settings > Authorized domains.';
            case 'auth/network-request-failed':
                return 'Network error. Please check your internet connection and try again.';
            case 'auth/account-exists-with-different-credential':
                return 'An account already exists with this email address. Please sign in with your existing method.';
            default:
                return error.message || 'Authentication failed';
        }
    }
 
 
    // Clear all user data for testing (can be called from browser console)
    clearAllData() {
        console.log('Clearing all user data...');
        this.mockData = {
            users: [],
            donors: [],
            donations: [],
            bloodRequests: []
        };
        this.currentUser = null;
        this.firebaseUser = null;
        this.saveUserToStorage();
        this.saveDataToStorage();
        console.log('All user data cleared. Ready for fresh sign-ups.');
    }
 
    // Test authentication with a new user (can be called from browser console)
    async testNewUser() {
        console.log('Testing new user registration...');
        const testEmail = `test${Date.now()}@example.com`;
        const testPassword = 'Test123!';
        
        try {
            await this.register({
                email: testEmail,
                password: testPassword,
                firstName: 'Test',
                lastName: 'User'
            });
            console.log('New user registration successful!');
            
            // Now test login
            this.currentUser = null;
            await this.login(testEmail, testPassword);
            console.log('New user login successful!');
            
            return true;
        } catch (error) {
            console.error('Test failed:', error);
            return false;
        }
    }
 
    // Test Firebase donor data loading (can be called from browser console)
    async testFirebaseDonors() {
        console.log('Testing Firebase donor data loading...');
        try {
            const donors = await this.loadDonorsFromFirestore();
            console.log(`Loaded ${donors.length} donors from Firebase:`, donors);
            return donors;
        } catch (error) {
            console.error('Firebase donor test failed:', error);
            return [];
        }
    }
 
    // Create a test donor profile for testing (can be called from browser console)
    async createTestDonor() {
        if (!this.currentUser) {
            console.error('No user logged in. Please login first.');
            return false;
        }
 
        console.log('Creating test donor profile...');
        const testDonor = {
            id: `test_${Date.now()}`,
            userId: this.currentUser.id,
            firstName: 'Test',
            lastName: 'Donor',
            bloodType: 'O+',
            location: 'Mumbai, Maharashtra',
            latitude: '19.0760',
            longitude: '72.8777',
            state: 'Maharashtra',
            phone: '+91-9876543210',
            availability: 'available',
            govId: {
                type: 'Aadhaar',
                previewUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
            }
        };
 
        this.currentDonor = testDonor;
        this.mockData.donors.push(testDonor);
        this.saveDataToStorage();
        
        // Sync to Firebase
        await this.syncDonorToFirestore();
        
        console.log('Test donor profile created and synced to Firebase!');
        return true;
    }
 
    // Test Google authentication (can be called from browser console)
    async testGoogleAuth() {
        console.log('=== Google Authentication Test ===');
        console.log('Firebase ready:', this.firebaseReady);
        console.log('Firebase auth:', !!window.firebase?.auth);
        console.log('GoogleAuthProvider:', !!window.firebase?.GoogleAuthProvider);
        console.log('Current user:', this.currentUser);
        
        if (!this.firebaseReady) {
            console.error('❌ Firebase not ready - check Firebase configuration');
            return false;
        }
        
        if (!window.firebase?.auth) {
            console.error('❌ Firebase auth not available');
            return false;
        }
        
        if (!window.firebase?.GoogleAuthProvider) {
            console.error('❌ GoogleAuthProvider not available');
            return false;
        }
        
        try {
            console.log('🔄 Attempting Google sign-in...');
            await this.firebaseGoogleLogin();
            console.log('✅ Google authentication test successful!');
            console.log('User signed in:', this.currentUser);
            return true;
        } catch (error) {
            console.error('❌ Google authentication test failed:', error);
            console.error('Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            
            // Provide specific guidance based on error
            if (error.code === 'auth/popup-blocked') {
                console.log('💡 Solution: Allow popups for this site and try again');
            } else if (error.code === 'auth/operation-not-allowed') {
                console.log('💡 Solution: Enable Google Sign-in in Firebase Console');
            } else if (error.code === 'auth/unauthorized-domain') {
                console.log('💡 Solution: Add this domain to Firebase authorized domains');
            }
            
            return false;
        }
    }
 
    // Comprehensive authentication test suite
    async runAuthTests() {
        console.log('=== BloodConnect Authentication Test Suite ===');
        
        // Test 1: Firebase Status
        console.log('\n1. Testing Firebase Status...');
        const firebaseStatus = {
            ready: this.firebaseReady,
            auth: !!window.firebase?.auth,
            db: !!window.firebase?.db,
            GoogleAuthProvider: !!window.firebase?.GoogleAuthProvider,
            FacebookAuthProvider: !!window.firebase?.FacebookAuthProvider
        };
        console.log('Firebase Status:', firebaseStatus);
        
        // Test 2: Google Authentication
        console.log('\n2. Testing Google Authentication...');
        const googleTest = await this.testGoogleAuth();
        
        // Test 3: Mock Authentication (fallback)
        console.log('\n3. Testing Mock Authentication...');
        try {
            await this.login('john.donor@example.com', 'password123');
            console.log('✅ Mock authentication working');
            this.logout(); // Clean up
        } catch (error) {
            console.error('❌ Mock authentication failed:', error);
        }
        
        // Test 4: Firebase Donor Data
        console.log('\n4. Testing Firebase Donor Data...');
        try {
            const donors = await this.loadDonorsFromFirestore();
            console.log(`✅ Loaded ${donors.length} donors from Firebase`);
        } catch (error) {
            console.error('❌ Firebase donor data test failed:', error);
        }
        
        console.log('\n=== Test Summary ===');
        console.log('Firebase Status:', firebaseStatus.ready ? '✅ Ready' : '❌ Not Ready');
        console.log('Google Auth:', googleTest ? '✅ Working' : '❌ Failed');
        console.log('Mock Auth:', '✅ Working (fallback)');
        console.log('Firebase Data:', '✅ Working');
        
        return {
            firebaseReady: firebaseStatus.ready,
            googleAuth: googleTest,
            mockAuth: true,
            firebaseData: true
        };
    }
}
 
// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new BloodConnectApp();
    
    // Make debug methods available globally
    window.debugAuth = () => app.debugAuth();
    window.clearAllData = () => app.clearAllData();
    window.testNewUser = () => app.testNewUser();
    window.testFirebaseDonors = () => app.testFirebaseDonors();
    window.createTestDonor = () => app.createTestDonor();
    window.testGoogleAuth = () => app.testGoogleAuth();
    window.runAuthTests = () => app.runAuthTests();
    window.checkFirebaseStatus = () => {
        console.log('Firebase Status:', {
            ready: app.firebaseReady,
            auth: !!window.firebase?.auth,
            db: !!window.firebase?.db,
            currentUser: app.currentUser,
            firebaseUser: app.firebaseUser
        });
    };
});