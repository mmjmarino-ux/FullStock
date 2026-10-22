<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Throwable;

class AuthController extends Controller
{
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
        ];
    }
}
