<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\Product;
use App\Models\Sale;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SalesController extends Controller
{
    public function index(Request $request)
    {
        return Sale::query()
            ->whereHas('items', fn ($query) => $query->whereNotNull('product_id'))
            ->whereDoesntHave('items', fn ($query) => $query->whereNull('product_id'))
            ->with('items')
            ->latest('sold_at')
            ->get()
            ->map(fn (Sale $sale) => $this->payload($sale));
    }

    public function store(Request $request)
    {
        $canSetPrice = $request->user()->can('manage-workspace');
        $rules = [
            'product_id' => ['required', 'exists:products,id'],
            'quantity' => ['required', 'integer', 'min:1'],
        ];
        if ($canSetPrice) {
            $rules['unit_price'] = ['nullable', 'numeric', 'gt:0'];
        }
        $data = $request->validate($rules);

        $sale = DB::transaction(function () use ($data, $canSetPrice) {
            $product = Product::whereKey($data['product_id'])->lockForUpdate()->firstOrFail();
            if ((float) $product->price <= 0) {
                throw ValidationException::withMessages(['product_id' => ['Set a price greater than zero before recording this sale.']]);
            }
            if ($product->stock < $data['quantity']) {
                throw ValidationException::withMessages(['quantity' => ['There is not enough stock to complete this sale.']]);
            }

            // Staff always sell at the administrator-managed catalog price.
            $unitPrice = $canSetPrice ? (float) ($data['unit_price'] ?? $product->price) : (float) $product->price;
            if ($unitPrice <= 0) {
                throw ValidationException::withMessages(['unit_price' => ['Enter the actual sale price before recording this sale.']]);
            }
            $total = round($unitPrice * $data['quantity'], 2);
            $sale = Sale::create([
                'sale_number' => 'PENDING-' . Str::uuid(),
                'total' => $total,
                'status' => 'Completed',
                'sold_at' => now(),
            ]);
            $sale->update(['sale_number' => 'S-' . str_pad((string) $sale->id, 5, '0', STR_PAD_LEFT)]);
            $sale->items()->create([
                'product_id' => $product->id,
                'product_name' => $product->name,
                'quantity' => $data['quantity'],
                'unit_price' => $unitPrice,
                'line_total' => $total,
            ]);
            $product->decrement('stock', $data['quantity']);
            InventoryMovement::create([
                'product_id' => $product->id,
                'product_name' => $product->name,
                'type' => 'Sale',
                'quantity' => -$data['quantity'],
                'reference' => 'Sale #' . $sale->sale_number,
            ]);
            return $sale->fresh('items');
        });

        return response()->json($this->payload($sale), 201);
    }

    private function payload(Sale $sale): array
    {
        return [
            'id' => $sale->id,
            'number' => $sale->sale_number,
            'date' => $sale->sold_at?->toISOString(),
            'total' => (float) $sale->total,
            'status' => $sale->status,
            'items' => $sale->items->map(fn ($item) => [
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'quantity' => $item->quantity,
                'price' => (float) $item->unit_price,
            ])->values(),
        ];
    }
}
