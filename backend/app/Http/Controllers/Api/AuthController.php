<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use App\Models\PasswordResetRequest;
use Throwable;

class AuthController extends Controller
{
    public function setupStatus()
    {
        return response()->json([
            'setup_available' => filled(config('services.admin_setup_key')) && !User::query()->exists(),
        ]);
    }

    public function setupAdministrator(Request $request)
    {
        $data = $request->validate([
            'setup_key' => ['required', 'string', 'max:255'],
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'min:12', 'confirmed'],
        ]);
        $expectedKey = (string) config('services.admin_setup_key');

        if ($expectedKey === '' || !hash_equals($expectedKey, $data['setup_key'])) {
            return response()->json(['message' => 'Administrator setup is unavailable or the setup key is incorrect.'], 403);
        }

        return DB::transaction(function () use ($data) {
            if (DB::connection()->getDriverName() === 'pgsql') {
                DB::statement('LOCK TABLE users IN EXCLUSIVE MODE');
            }

            if (User::query()->exists()) {
                return response()->json(['message' => 'An account already exists. Administrator setup is closed.'], 409);
            }

            $user = User::create([
                'name' => $data['name'],
                'email' => $data['email'],
                'password' => $data['password'],
                'role' => 'admin',
            ]);

            return $this->authenticatedResponse($user);
        });
    }

    public function createStaffAccount(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'role' => 'staff',
        ]);

        return response()->json([
            'user' => $this->userPayload($user),
            'message' => 'Staff account created.',
        ], 201);
    }

    public function staffAccounts()
    {
        $staff = User::query()
            ->whereRaw('LOWER(TRIM(role)) = ?', ['staff'])
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'created_at', 'is_active']);

        return response()->json(['staff' => $staff]);
    }

    public function updateStaffAccountStatus(Request $request, User $staff)
    {
        if (strtolower(trim((string) $staff->role)) !== 'staff') {
            return response()->json([
                'message' => 'Only staff account status can be changed here.',
            ], 404);
        }

        $request->validate([
            'is_active' => ['required', 'boolean'],
        ]);

        $staff->is_active = $request->boolean('is_active');
        $staff->save();

        if (!$staff->is_active) {
            $staff->tokens()->delete();
        }

        return response()->json([
            'staff' => $staff->only(['id', 'name', 'email', 'created_at', 'is_active']),
            'message' => $staff->is_active
                ? 'Staff account reactivated.'
                : 'Staff account deactivated.',
        ]);
    }

    public function deleteInactiveStaffAccount(User $staff)
    {
        if (strtolower(trim((string) $staff->role)) !== 'staff') {
            return response()->json([
                'message' => 'Only staff accounts can be deleted here.',
            ], 404);
        }

        if ($staff->is_active) {
            return response()->json([
                'message' => 'Deactivate this staff account before deleting it.',
            ], 409);
        }

        $staff->tokens()->delete();
        $staff->delete();

        return response()->json([
            'message' => 'Inactive staff account permanently deleted.',
        ]);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (!$user || !Hash::check($data['password'], $user->password)) {
            return response()->json([
                'message' => 'These credentials do not match our records.',
            ], 422);
        }

        if (!$user->is_active) {
            return response()->json([
                'message' => 'This account is inactive. Contact an administrator.',
            ], 403);
        }

        if (!in_array(strtolower(trim((string) $user->role)), ['admin', 'administrator', 'staff'], true)) {
            return response()->json([
                'message' => 'This account type is no longer supported. Contact an administrator for staff access.',
            ], 403);
        }

        return $this->authenticatedResponse($user);
    }

    public function forgotPassword(Request $request)
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        try {
            $status = Password::sendResetLink($data);
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'message' => 'We could not send a reset link. Check the mail settings in backend/.env and try again.',
            ], 503);
        }

        if ($status === Password::RESET_THROTTLED) {
            return response()->json([
                'message' => 'Please wait a minute before requesting another reset link.',
            ], 429);
        }

        return response()->json([
            'message' => 'If an account exists for this email, a password reset link has been sent.',
            'delivery_mode' => config('mail.default'),
        ]);
    }

    public function submitPasswordResetRequest(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'message' => ['nullable', 'string', 'max:1000'],
        ]);

        $email = mb_strtolower(trim($data['email']));

        $isStaffAccount = User::query()
            ->whereRaw('LOWER(email) = ?', [$email])
            ->whereRaw('LOWER(TRIM(role)) = ?', ['staff'])
            ->exists();

        if ($isStaffAccount) {
            $alreadyPending = PasswordResetRequest::query()
                ->whereRaw('LOWER(email) = ?', [$email])
                ->where('status', 'pending')
                ->exists();

            if (!$alreadyPending) {
                PasswordResetRequest::create([
                    'email' => $email,
                    'message' => $data['message'] ?? null,
                ]);
            }
        }

        return response()->json([
            'message' => 'If this email belongs to a staff account, the request has been sent to an administrator.',
        ]);
    }

    public function pendingPasswordResetRequests()
    {
        $requests = PasswordResetRequest::query()
            ->where('status', 'pending')
            ->latest()
            ->limit(100)
            ->get(['id', 'email', 'message', 'status', 'created_at']);

        return response()->json(['requests' => $requests]);
    }

    public function deletePasswordResetRequest(PasswordResetRequest $passwordResetRequest)
    {
        if ($passwordResetRequest->status !== 'pending') {
            return response()->json([
                'message' => 'Only pending requests can be deleted.',
            ], 409);
        }

        $passwordResetRequest->delete();

        return response()->json([
            'message' => 'Password reset request deleted.',
        ]);
    }

    public function resetStaffPassword(Request $request, PasswordResetRequest $passwordResetRequest)
    {
        if ($passwordResetRequest->status !== 'pending') {
            return response()->json(['message' => 'This request has already been handled.'], 409);
        }

        $email = mb_strtolower(trim($passwordResetRequest->email));

        $staff = User::query()
            ->whereRaw('LOWER(email) = ?', [$email])
            ->whereRaw('LOWER(TRIM(role)) = ?', ['staff'])
            ->first();

        if (!$staff) {
            return response()->json(['message' => 'No staff account was found for this request.'], 404);
        }

        $temporaryPassword = Str::random(32);

        $staff->forceFill([
            'password' => Hash::make($temporaryPassword),
            'must_change_password' => true,
            'remember_token' => Str::random(60),
        ])->save();

        $staff->tokens()->delete();

        $passwordResetRequest->forceFill([
            'status' => 'completed',
            'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(),
        ])->save();

        return response()->json([
            'message' => 'Password reset. Give the temporary password to the staff member through a private channel.',
            'temporary_password' => $temporaryPassword,
        ]);
    }

    public function changeTemporaryPassword(Request $request)
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string',     'min:12', 'confirmed', 'different:current_password'],
        ]);

        $user = $request->user();

        if (!Hash::check($data['current_password'], $user->password)) {
            return response()->json(['message' => 'The temporary password is incorrect.'], 422);
        }

        $user->forceFill([
            'password' => Hash::make($data['new_password']),
            'must_change_password' => false,
            'remember_token' => Str::random(60),
        ])->save();

        return response()->json([
            'message' => 'Password changed successfully.',
            'user' => $this->userPayload($user),
        ]);
    }

    public function resetPassword(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $status = Password::reset($data, function (User $user, string $password) {
            $user->forceFill([
                'password' => Hash::make($password),
                'remember_token' => Str::random(60),
            ])->save();
            $user->tokens()->delete();
            event(new PasswordReset($user));
        });

        if ($status === Password::PASSWORD_RESET) {
            return response()->json(['message' => 'Password reset successfully. Please sign in.']);
        }

        return response()->json([
            'message' => $status === Password::RESET_THROTTLED
                ? 'Please wait before trying this reset link again.'
                : 'This reset link is invalid or expired. Request a new link and try again.',
        ], 422);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()?->delete();
        return response()->json(['message' => 'Signed out.']);
    }

    private function authenticatedResponse(User $user)
    {
        return response()->json([
            'user' => $this->userPayload($user),
            'token' => $user->createToken('fullstock-web')->plainTextToken,
        ]);
    }

    private function userPayload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => ucfirst($user->role),
            'must_change_password' => (bool) $user->must_change_password,
        ];
    }
}
