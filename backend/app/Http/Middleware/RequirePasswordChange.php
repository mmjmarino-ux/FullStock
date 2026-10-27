<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class RequirePasswordChange
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->user()?->must_change_password) {
            return response()->json([
                'message' => 'You must choose a new password before continuing.',
                'must_change_password' => true,
            ], 423);
        }

        return $next($request);
    }
}