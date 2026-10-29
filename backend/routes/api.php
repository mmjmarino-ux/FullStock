<?php

use App\Http\Controllers\Api\AssistantController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SalesController;
use App\Http\Controllers\Api\SupplierController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::get('/setup/status', [AuthController::class, 'setupStatus']);
Route::post('/setup/administrator', [AuthController::class, 'setupAdministrator'])->middleware('throttle:5,1');
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:6,1');
Route::post('/password-reset-requests', [AuthController::class, 'submitPasswordResetRequest'])->middleware('throttle:password-reset-requests');
Route::post('/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:6,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/password/change', [AuthController::class, 'changeTemporaryPassword']);

    Route::middleware('password.changed')->group(function () {
        Route::middleware('can:operate-workspace')->group(function () {
            Route::get('/products', [ProductController::class, 'index']);
            Route::get('/products/{product}', [ProductController::class, 'show']);
            Route::get('/sales', [SalesController::class, 'index']);
            Route::post('/sales', [SalesController::class, 'store']);
            Route::get('/suppliers', [SupplierController::class, 'index']);
            Route::get('/suppliers/{supplier}', [SupplierController::class, 'show']);
            Route::get('/inventory/movements', [InventoryController::class, 'movements']);
            Route::post('/assistant', [AssistantController::class, 'ask'])->middleware('throttle:20,1');
        });

        Route::middleware('can:manage-workspace')->group(function () {
            Route::post('/staff-accounts', [AuthController::class, 'createStaffAccount'])->middleware('throttle:6,1');
            Route::get('/password-reset-requests', [AuthController::class, 'pendingPasswordResetRequests']);
            Route::post('/password-reset-requests/{passwordResetRequest}/reset', [AuthController::class, 'resetStaffPassword'])->middleware('throttle:6,1');
            Route::apiResource('products', ProductController::class)->only(['store', 'update', 'destroy']);
            Route::apiResource('suppliers', SupplierController::class)->only(['store', 'update', 'destroy']);
            Route::post('/inventory/adjustments', [InventoryController::class, 'adjust']);
            Route::delete('/password-reset-requests/{passwordResetRequest}', [AuthController::class, 'deletePasswordResetRequest']);
            Route::get('/staff-accounts', [AuthController::class, 'staffAccounts']);
            Route::patch('/staff-accounts/{staff}/status', [AuthController::class, 'updateStaffAccountStatus']);
            Route::delete('/staff-accounts/{staff}', [AuthController::class, 'deleteInactiveStaffAccount']);
        });
    });
});
