<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\InventoryBatch;
use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SalesController extends Controller
{
    public function index(Request $request)
    {
        return Sale::query()
            ->whereHas('items', fn ($query) => $query->whereNotNull('product_id'))
            ->whereDoesntHave('items', fn ($query) => $query->whereNull('product_id'))
            ->with(['items', 'voidedBy', 'approvedBy'])
            ->latest('sold_at')
            ->get()
            ->map(fn (Sale $sale) => $this->payload($sale, $request->user()));
    }

    public function store(Request $request)
    {
        $canSetPrice = $request->user()->can('manage-workspace');
        $today = now('Asia/Manila')->toDateString();
        if ($request->has('items')) {
            $rules = [
                'amount_paid' => ['sometimes', 'numeric', 'min:0'],
                'items' => ['required', 'array', 'min:1', 'max:50'],
                'items.*.product_id' => ['required', 'integer', 'exists:products,id'],
                'items.*.quantity' => ['required', 'integer', 'min:1'],
                'items.*.sale_unit' => ['sometimes', 'in:kg,bag_10kg,bag_15kg,bag_20kg'],
            ];
            if ($canSetPrice) {
                $rules['items.*.unit_price'] = ['nullable', 'numeric', 'gt:0'];
            }
            $data = $request->validate($rules);
            $items = $data['items'];
        } else {
            $rules = [
                'amount_paid' => ['sometimes', 'numeric', 'min:0'],
                'product_id' => ['required', 'exists:products,id'],
                'quantity' => ['required', 'integer', 'min:1'],
                'sale_unit' => ['sometimes', 'in:kg,bag_10kg,bag_15kg,bag_20kg'],
            ];
            if ($canSetPrice) {
                $rules['unit_price'] = ['nullable', 'numeric', 'gt:0'];
            }
            $data = $request->validate($rules);
            $items = [[
                'product_id' => $data['product_id'],
                'quantity' => $data['quantity'],
                'sale_unit' => $data['sale_unit'] ?? 'kg',
                'unit_price' => $data['unit_price'] ?? null,
            ]];
        }

        $amountPaid = array_key_exists('amount_paid', $data)
            ? round((float) $data['amount_paid'], 2)
            : null;
        $sale = DB::transaction(function () use ($items, $canSetPrice, $request, $amountPaid, $today) {
            $productIds = collect($items)->pluck('product_id')->unique()->sort()->values();
            $products = Product::whereKey($productIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            if ($products->count() !== $productIds->count()) {
                throw ValidationException::withMessages(['items' => ['One or more rice products are no longer available.']]);
            }

            $requestedByProduct = collect($items)->groupBy('product_id')->map(fn ($lines) => $lines->sum('quantity'));
            foreach ($requestedByProduct as $productId => $requestedQuantity) {
                $availableQuantity = InventoryBatch::query()
                    ->where('product_id', $productId)
                    ->where('remaining_quantity', '>', 0)
                    ->where(fn ($query) => $query->whereNull('expiration_date')->orWhereDate('expiration_date', '>=', $today))
                    ->sum('remaining_quantity');
                if ($availableQuantity < $requestedQuantity) {
                    $productName = $products->get($productId)?->name ?? 'This product';
                    throw ValidationException::withMessages(['items' => ["There is not enough unexpired batch stock for {$productName}."]]);
                }
            }

            $pricedItems = [];
            $total = 0;
            foreach ($items as $index => $item) {
                $product = $products->get($item['product_id']);
                $saleUnit = $item['sale_unit'] ?? 'kg';
                $bagWeight = match ($saleUnit) {
                    'bag_10kg' => 10,
                    'bag_15kg' => 15,
                    'bag_20kg' => 20,
                    default => 1,
                };
                if ($item['quantity'] % $bagWeight !== 0) {
                    throw ValidationException::withMessages(["items.{$index}.quantity" => ['Bag quantities must be a whole number of the selected bag size.']]);
                }
                if ((float) $product->price <= 0) {
                    throw ValidationException::withMessages(["items.{$index}.product_id" => ['Set a price greater than zero before recording this sale.']]);
                }
                // Staff always sell at the administrator-managed catalog price.
                $unitPrice = $canSetPrice ? (float) ($item['unit_price'] ?? $product->price) : (float) $product->price;
                if ($unitPrice <= 0) {
                    throw ValidationException::withMessages(["items.{$index}.unit_price" => ['Enter the actual sale price before recording this sale.']]);
                }
                $lineTotal = round($unitPrice * $item['quantity'], 2);
                $total = round($total + $lineTotal, 2);
                $pricedItems[] = compact('product', 'item', 'unitPrice', 'lineTotal', 'saleUnit');
            }
            $amountPaid = $amountPaid ?? $total;

            if ($amountPaid < $total) {
                throw ValidationException::withMessages(['amount_paid' => ['The amount received must cover the total due.']]);
            }

            $sale = Sale::create([
                'sale_number' => 'PENDING-' . Str::uuid(),
                'total' => $total,
                'amount_paid' => $amountPaid,
                'change_given' => round($amountPaid - $total, 2),
                'status' => 'Completed',
                'sold_at' => now(),
                'sold_by' => $request->user()->id,
            ]);
            $baseSaleNumber = 'S-' . str_pad((string) $sale->id, 5, '0', STR_PAD_LEFT);
            $saleNumber = $baseSaleNumber;
            $suffix = 1;
            while (Sale::where('sale_number', $saleNumber)->exists()) {
                $saleNumber = $baseSaleNumber . '-' . str_pad((string) $suffix++, 2, '0', STR_PAD_LEFT);
            }
            $sale->update(['sale_number' => $saleNumber]);

            foreach ($pricedItems as $pricedItem) {
                $product = $pricedItem['product'];
                $item = $pricedItem['item'];
                $saleItem = $sale->items()->create([
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'quantity' => $item['quantity'],
                    'sale_unit' => $pricedItem['saleUnit'],
                    'unit_price' => $pricedItem['unitPrice'],
                    'line_total' => $pricedItem['lineTotal'],
                ]);
                $remainingToAllocate = (int) $item['quantity'];
                $batches = InventoryBatch::query()
                    ->where('product_id', $product->id)
                    ->where('remaining_quantity', '>', 0)
                    ->where(fn ($query) => $query->whereNull('expiration_date')->orWhereDate('expiration_date', '>=', $today))
                    ->orderByRaw('CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END')
                    ->orderBy('expiration_date')
                    ->orderBy('created_at')
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get();
                foreach ($batches as $batch) {
                    if ($remainingToAllocate <= 0) {
                        break;
                    }
                    $allocated = min($remainingToAllocate, (int) $batch->remaining_quantity);
                    $batch->decrement('remaining_quantity', $allocated);
                    DB::table('sale_item_batches')->insert([
                        'sale_item_id' => $saleItem->id,
                        'inventory_batch_id' => $batch->id,
                        'quantity' => $allocated,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $remainingToAllocate -= $allocated;
                }
                if ($remainingToAllocate > 0) {
                    throw ValidationException::withMessages(['items' => ["Batch stock changed while recording the sale for {$product->name}. Please retry."]]);
                }
                $product->decrement('stock', $item['quantity']);
                InventoryMovement::create([
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'type' => 'Sale',
                    'quantity' => -$item['quantity'],
                    'reference' => 'Sale #' . $sale->sale_number,
                ]);
            }

            return $sale->fresh('items');
        });

        return response()->json($this->payload($sale, $request->user()), 201);
    }

    public function void(Request $request, Sale $sale)
    {
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:500'],
            'approval_code' => ['sometimes', 'nullable', 'digits:6'],
        ]);
        $actor = $request->user();
        $isAdmin = $actor->can('manage-workspace');

        $approvalId = null;
        if (! $isAdmin && $sale->sold_at?->lt(now()->subMinutes(10))) {
            if ((int) $sale->sold_by !== (int) $actor->id) {
                throw new AuthorizationException('Staff can void only their own sales.');
            }
            $approvalId = $this->validateApprovalCode($sale->id, $actor->id, trim($data['reason']), $data['approval_code'] ?? '');
        }

        $updatedSale = DB::transaction(function () use ($sale, $actor, $isAdmin, $data, $approvalId) {
            $lockedSale = Sale::whereKey($sale->id)->lockForUpdate()->with('items')->firstOrFail();
            if ($lockedSale->voided_at || $lockedSale->status === 'Voided') {
                throw ValidationException::withMessages(['sale' => ['This sale has already been voided.']]);
            }
            $approvingAdminId = null;
            if (! $isAdmin) {
                if ((int) $lockedSale->sold_by !== (int) $actor->id) {
                    throw new AuthorizationException('Staff can void only their own sales.');
                }
                if (! $lockedSale->sold_at || $lockedSale->sold_at->lt(now()->subMinutes(10))) {
                    if (! $approvalId) {
                        throw ValidationException::withMessages(['approval_code' => ['Request a one-time administrator code for this sale before voiding it.']]);
                    }
                    $approval = DB::table('sale_void_approval_codes')
                        ->where('id', $approvalId)
                        ->where('sale_id', $lockedSale->id)
                        ->where('staff_id', $actor->id)
                        ->whereNull('used_at')
                        ->whereNull('invalidated_at')
                        ->where('expires_at', '>', now())
                        ->lockForUpdate()
                        ->first();
                    if (! $approval || ! Hash::check($data['approval_code'] ?? '', $approval->code_hash) || ! hash_equals($approval->reason, trim($data['reason']))) {
                        throw ValidationException::withMessages(['approval_code' => ['This one-time code is invalid or expired. Request a new code from an administrator.']]);
                    }
                    $approverIsActive = User::query()
                        ->whereKey($approval->admin_id)
                        ->whereRaw('LOWER(TRIM(role)) IN (?, ?)', ['admin', 'administrator'])
                        ->where('is_active', true)
                        ->where('must_change_password', false)
                        ->exists();
                    if (! $approverIsActive) {
                        throw ValidationException::withMessages(['approval_code' => ['The administrator account that received this code is no longer active. Request a new code.']]);
                    }
                    $approvingAdminId = $approval->admin_id;
                    DB::table('sale_void_approval_codes')->where('id', $approval->id)->update(['used_at' => now(), 'updated_at' => now()]);
                }
            }

            $items = $lockedSale->items->filter(fn ($item) => $item->product_id !== null);
            $products = Product::whereKey($items->pluck('product_id')->unique()->sort()->values())
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

            foreach ($items as $item) {
                $product = $products->get($item->product_id);
                if (! $product) {
                    throw ValidationException::withMessages(['sale' => ['A product from this sale is no longer available, so stock cannot be restored safely.']]);
                }
                $allocations = DB::table('sale_item_batches')->where('sale_item_id', $item->id)->get();
                if ($allocations->isEmpty()) {
                    $batch = $product->batches()->create([
                        'batch_code' => 'VOID-' . $lockedSale->id . '-' . $item->id,
                        'received_quantity' => $item->quantity,
                        'remaining_quantity' => $item->quantity,
                        'expiration_date' => null,
                        'note' => 'Restored from a sale recorded before batch tracking',
                    ]);
                } else {
                    foreach ($allocations as $allocation) {
                        $batch = InventoryBatch::whereKey($allocation->inventory_batch_id)->lockForUpdate()->first();
                        if (! $batch) {
                            throw ValidationException::withMessages(['sale' => ['A batch from this sale no longer exists, so stock cannot be restored safely.']]);
                        }
                        $batch->increment('remaining_quantity', $allocation->quantity);
                    }
                }
                $product->increment('stock', $item->quantity);
                InventoryMovement::create([
                    'product_id' => $product->id,
                    'product_name' => $item->product_name,
                    'type' => 'Sale Void',
                    'quantity' => $item->quantity,
                    'reference' => 'Void sale #' . $lockedSale->sale_number,
                    'note' => $data['reason'],
                ]);
            }

            $lockedSale->update([
                'status' => 'Voided',
                'voided_at' => now(),
                'voided_by' => $actor->id,
                'approved_by' => $approvingAdminId,
                'void_reason' => trim($data['reason']),
            ]);

            return $lockedSale->fresh(['items', 'voidedBy', 'approvedBy']);
        });

        return response()->json($this->payload($updatedSale, $actor));
    }

    public function voidApprovers(Request $request, Sale $sale)
    {
        $actor = $request->user();
        if ($actor->can('manage-workspace') || (int) $sale->sold_by !== (int) $actor->id) {
            throw new AuthorizationException('Only the cashier who recorded this sale can request a void code.');
        }
        if ($sale->voided_at || ! $sale->sold_at?->lt(now()->subMinutes(10))) {
            throw ValidationException::withMessages(['sale' => ['Administrator codes are only needed for your own sales older than 10 minutes.']]);
        }

        return User::query()
            ->whereRaw('LOWER(TRIM(role)) IN (?, ?)', ['admin', 'administrator'])
            ->where('is_active', true)
            ->where('must_change_password', false)
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $admin) => ['id' => $admin->id, 'name' => $admin->name])->values();
    }

    public function requestVoidCode(Request $request, Sale $sale)
    {
        $data = $request->validate([
            'admin_id' => ['required', 'integer', 'exists:users,id'],
            'reason' => ['required', 'string', 'min:3', 'max:500'],
        ]);
        $actor = $request->user();
        if ($actor->can('manage-workspace') || (int) $sale->sold_by !== (int) $actor->id) {
            throw new AuthorizationException('Only the cashier who recorded this sale can request a void code.');
        }
        if ($sale->voided_at || ! $sale->sold_at?->lt(now()->subMinutes(10))) {
            throw ValidationException::withMessages(['sale' => ['Administrator codes are only needed for your own sales older than 10 minutes.']]);
        }

        $admin = User::query()
            ->whereKey($data['admin_id'])
            ->whereRaw('LOWER(TRIM(role)) IN (?, ?)', ['admin', 'administrator'])
            ->where('is_active', true)
            ->where('must_change_password', false)
            ->first();
        if (! $admin) {
            throw ValidationException::withMessages(['admin_id' => ['Select an active administrator.']]);
        }

        $rateKey = 'sale-void-code:' . $actor->id . ':' . $sale->id;
        if (RateLimiter::tooManyAttempts($rateKey, 3)) {
            throw ValidationException::withMessages(['admin_id' => ['Too many code requests for this sale. Try again in 15 minutes.']]);
        }
        RateLimiter::hit($rateKey, 900);

        $plainCode = (string) random_int(100000, 999999);
        $approvalId = DB::transaction(function () use ($sale, $actor, $admin, $data, $plainCode) {
            DB::table('sale_void_approval_codes')
                ->where('sale_id', $sale->id)
                ->where('staff_id', $actor->id)
                ->whereNull('used_at')
                ->whereNull('invalidated_at')
                ->update(['invalidated_at' => now(), 'updated_at' => now()]);

            return DB::table('sale_void_approval_codes')->insertGetId([
                'sale_id' => $sale->id,
                'staff_id' => $actor->id,
                'admin_id' => $admin->id,
                'code_hash' => Hash::make($plainCode),
                'code_encrypted' => Crypt::encryptString($plainCode),
                'reason' => trim($data['reason']),
                'expires_at' => now()->addMinutes(5),
                'attempts' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return response()->json([
            'message' => 'One-time code is available to ' . $admin->name . ' in the notification bell.',
            'admin_name' => $admin->name,
            'expires_at' => now()->addMinutes(5)->toIso8601String(),
        ]);
    }

    public function voidApprovals(Request $request)
    {
        abort_unless($request->user()->is_active && $request->user()->can('manage-workspace'), 403);
        $rows = DB::table('sale_void_approval_codes')
            ->join('sales', 'sales.id', '=', 'sale_void_approval_codes.sale_id')
            ->join('users as staff', 'staff.id', '=', 'sale_void_approval_codes.staff_id')
            ->where('sale_void_approval_codes.admin_id', $request->user()->id)
            ->whereNull('sale_void_approval_codes.used_at')
            ->whereNull('sale_void_approval_codes.invalidated_at')
            ->where('sale_void_approval_codes.expires_at', '>', now())
            ->whereNotNull('sale_void_approval_codes.code_encrypted')
            ->whereNull('sales.voided_at')
            ->orderByDesc('sale_void_approval_codes.created_at')
            ->get([
                'sale_void_approval_codes.id',
                'sale_void_approval_codes.sale_id',
                'sale_void_approval_codes.code_encrypted',
                'sale_void_approval_codes.reason',
                'sale_void_approval_codes.created_at',
                'sale_void_approval_codes.expires_at',
                'sales.sale_number',
                'staff.name as staff_name',
            ]);

        return $rows->map(fn ($row) => [
            'id' => $row->id,
            'sale_id' => $row->sale_id,
            'sale_number' => $row->sale_number,
            'staff_name' => $row->staff_name,
            'reason' => $row->reason,
            'code' => Crypt::decryptString($row->code_encrypted),
            'requested_at' => $row->created_at,
            'expires_at' => \Illuminate\Support\Carbon::parse($row->expires_at, 'UTC')->toIso8601String(),
        ])->values();
    }

    private function validateApprovalCode(int $saleId, int $staffId, string $reason, string $submittedCode): int
    {
        $result = DB::transaction(function () use ($saleId, $staffId, $reason, $submittedCode) {
            $approval = DB::table('sale_void_approval_codes')
                ->where('sale_id', $saleId)
                ->where('staff_id', $staffId)
                ->whereNull('used_at')
                ->whereNull('invalidated_at')
                ->orderByDesc('id')
                ->lockForUpdate()
                ->first();

            if (! $approval || now()->gte($approval->expires_at) || (int) $approval->attempts >= 5) {
                return ['error' => 'No valid code is available. Request a new code from an administrator.'];
            }
            if (! hash_equals($approval->reason, $reason)) {
                return ['error' => 'The void reason changed after the code was sent. Request a new code.'];
            }
            if (! Hash::check($submittedCode, $approval->code_hash)) {
                $attempts = (int) $approval->attempts + 1;
                DB::table('sale_void_approval_codes')->where('id', $approval->id)->update([
                    'attempts' => $attempts,
                    'invalidated_at' => $attempts >= 5 ? now() : null,
                    'updated_at' => now(),
                ]);
                return ['error' => $attempts >= 5 ? 'Too many incorrect codes. Request a new code.' : 'The code is incorrect. Try again or request a new one.'];
            }

            return ['id' => (int) $approval->id];
        });

        if (isset($result['error'])) {
            throw ValidationException::withMessages(['approval_code' => [$result['error']]]);
        }
        return $result['id'];
    }

    private function payload(Sale $sale, $actor): array
    {
        $isAdmin = $actor->can('manage-workspace');
        $isRecentOwner = (int) $sale->sold_by === (int) $actor->id
            && $sale->sold_at?->gte(now()->subMinutes(10))
            && $sale->sold_at?->lte(now());
        return [
            'id' => $sale->id,
            'number' => $sale->sale_number,
            'date' => $sale->sold_at?->toISOString(),
            'total' => (float) $sale->total,
            'amount_paid' => $sale->amount_paid === null ? null : (float) $sale->amount_paid,
            'change_given' => $sale->change_given === null ? null : (float) $sale->change_given,
            'status' => $sale->status,
            'sold_by' => $sale->sold_by,
            'voided_at' => $sale->voided_at?->toISOString(),
            'voided_by' => $sale->voided_by,
            'voided_by_name' => $sale->voidedBy?->name,
            'approved_by' => $sale->approved_by,
            'approved_by_name' => $sale->approvedBy?->name,
            'void_reason' => $sale->void_reason,
            'can_void' => ! $sale->voided_at && ($isAdmin || $isRecentOwner),
            'can_request_admin_void' => ! $sale->voided_at && ! $isAdmin && (int) $sale->sold_by === (int) $actor->id,
            'items' => $sale->items->map(fn ($item) => [
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'quantity' => $item->quantity,
                'sale_unit' => $item->sale_unit ?? 'kg',
                'price' => (float) $item->unit_price,
                    'batch_allocations' => DB::table('sale_item_batches')
                        ->join('inventory_batches', 'inventory_batches.id', '=', 'sale_item_batches.inventory_batch_id')
                        ->where('sale_item_batches.sale_item_id', $item->id)
                        ->get([
                            'inventory_batches.id',
                            'inventory_batches.batch_code',
                            'inventory_batches.expiration_date',
                            'sale_item_batches.quantity',
                        ])
                        ->map(fn ($allocation) => [
                            'batch_id' => $allocation->id,
                            'batch_code' => $allocation->batch_code,
                            'expiration_date' => $allocation->expiration_date,
                            'quantity' => (int) $allocation->quantity,
                        ])->values(),
            ])->values(),
        ];
    }
}
