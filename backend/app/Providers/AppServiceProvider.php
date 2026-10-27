<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('password-reset-requests', function (Request $request) {
            $email = mb_strtolower(trim((string) $request->input('email')));
            $ip = (string) ($request->ip() ?? 'unknown');
            $emailKey = hash('sha256', $email);

            return [
                Limit::perMinutes(10, 3)->by($ip . '|email:' . $emailKey),
                Limit::perMinutes(10, 20)->by('ip:' . $ip),
            ];
        });

        Gate::define('manage-workspace', fn (User $user) => in_array(strtolower(trim((string) $user->role)), ['admin', 'administrator'], true));
        Gate::define('operate-workspace', fn (User $user) => in_array(strtolower(trim((string) $user->role)), ['admin', 'administrator', 'staff'], true));
        ResetPassword::createUrlUsing(function (User $user, string $token): string {
            return rtrim(config('services.frontend_url'), '/') . '/?token=' . urlencode($token)
                . '&email=' . urlencode($user->getEmailForPasswordReset());
        });
    }
}
