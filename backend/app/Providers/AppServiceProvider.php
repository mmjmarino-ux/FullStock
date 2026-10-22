<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

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
        Gate::define('manage-workspace', fn (User $user) => in_array(strtolower(trim((string) $user->role)), ['admin', 'administrator'], true));
        Gate::define('operate-workspace', fn (User $user) => in_array(strtolower(trim((string) $user->role)), ['admin', 'administrator', 'staff'], true));
        ResetPassword::createUrlUsing(function (User $user, string $token): string {
            return rtrim(config('services.frontend_url'), '/') . '/?token=' . urlencode($token)
                . '&email=' . urlencode($user->getEmailForPasswordReset());
        });
    }
}
