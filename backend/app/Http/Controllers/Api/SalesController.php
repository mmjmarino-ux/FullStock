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
        if ($request->has('items')) {
            $rules = [
                'items' => ['required', 'array', 'min:1', 'max:50'],
                'items.*.product_id' => ['required', 'integer', 'distinct', 'exists:products,id'],
                'items.*.quantity' => ['required', 'integer', 'min:1'],
            ];
            if ($canSetPrice) {
                $rules['items.*.unit_price'] = ['nullable', 'numeric', 'gt:0'];
            }
            $data = $request->validate($rules);
            $items = $data['items'];
        } else {
            $rules = [
                'product_id' => ['required', 'exists:products,id'],
                'quantity' => ['required', 'integer', 'min:1'],
            ];
            if ($canSetPrice) {
                $rules['unit_price'] = ['nullable', 'numeric', 'gt:0'];
            }
            $data = $request->validate($rules);
            $items = [[
                'product_id' => $data['product_id'],
                'quantity' => $data['quantity'],
                'unit_price' => $data['unit_price'] ?? null,
            ]];
        }

        $sale = DB::transaction(function () use ($items, $canSetPrice) {
            $productIds = collect($items)->pluck('product_id')->unique()->sort()->values();
            $products = Product::whereKey($productIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            if ($products->count() !== $productIds->count()) {
                throw ValidationException::withMessages(['items' => ['One or more rice products are no longer available.']]);
            }

            $pricedItems = [];
            $total = 0;
            foreach ($items as $index => $item) {
                $product = $products->get($item['product_id']);
                if ((float) $product->price <= 0) {
                    throw ValidationException::withMessages(["items.{$index}.product_id" => ['Set a price greater than zero before recording this sale.']]);
                }
                if ($product->stock < $item['quantity']) {
                    throw ValidationException::withMessages(["items.{$index}.quantity" => ["There is not enough stock for {$product->name}."]]);
                }

                // Staff always sell at the administrator-managed catalog price.
                $unitPrice = $canSetPrice ? (float) ($item['unit_price'] ?? $product->price) : (float) $product->price;
                if ($unitPrice <= 0) {
                    throw ValidationException::withMessages(["items.{$index}.unit_price" => ['Enter the actual sale price before recording this sale.']]);
                }
                $lineTotal = round($unitPrice * $item['quantity'], 2);
                $total = round($total + $lineTotal, 2);
                $pricedItems[] = compact('product', 'item', 'unitPrice', 'lineTotal');
            }

            $sale = Sale::create([
                'sale_number' => 'PENDING-' . Str::uuid(),
                'total' => $total,
                'status' => 'Completed',
                'sold_at' => now(),
            ]);
            $sale->update(['sale_number' => 'S-' . str_pad((string) $sale->id, 5, '0', STR_PAD_LEFT)]);

            foreach ($pricedItems as $pricedItem) {
                $product = $pricedItem['product'];
                $item = $pricedItem['item'];
                $sale->items()->create([
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'quantity' => $item['quantity'],
                    'unit_price' => $pricedItem['unitPrice'],
                    'line_total' => $pricedItem['lineTotal'],
                ]);
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
