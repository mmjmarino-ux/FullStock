<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryController extends Controller
{
    public function movements()
    {
        return InventoryMovement::whereNotNull('product_id')->latest()->limit(100)->get()->map(fn (InventoryMovement $movement) => [
            'id' => $movement->id,
            'date' => $movement->created_at?->toISOString(),
            'product_id' => $movement->product_id,
            'product_name' => $movement->product_name,
            'type' => $movement->type,
            'quantity' => $movement->quantity,
            'reference' => $movement->reference,
        ]);
    }

    public function adjust(Request $request)
    {
        $data = $request->validate([
            'product_id' => ['required', 'exists:products,id'],
            'quantity' => ['required', 'integer', 'min:1'],
            'type' => ['required', 'in:in,out'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $movement = DB::transaction(function () use ($data) {
            $product = Product::whereKey($data['product_id'])->lockForUpdate()->firstOrFail();
            $quantity = $data['type'] === 'in' ? $data['quantity'] : -$data['quantity'];
            if ($product->stock + $quantity < 0) {
                throw ValidationException::withMessages(['quantity' => ['Stock cannot be reduced below zero.']]);
            }
            $product->increment('stock', $quantity);
            return InventoryMovement::create([
                'product_id' => $product->id,
                'product_name' => $product->name,
                'type' => $data['type'] === 'in' ? 'Stock In' : 'Stock Out',
                'quantity' => $quantity,
                'reference' => $data['note'] ?? 'Manual adjustment',
                'note' => $data['note'] ?? null,
            ]);
        });

        return response()->json(['id' => $movement->id, 'message' => 'Inventory adjusted.'], 201);
    }
}
