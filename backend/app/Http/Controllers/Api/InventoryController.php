<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryMovement;
use App\Models\InventoryBatch;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryController extends Controller
{
    public function batches()
    {
        return InventoryBatch::query()
            ->with('product:id,name,category,stock,reorder_level')
            ->orderByRaw('CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END')
            ->orderBy('expiration_date')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->map(fn (InventoryBatch $batch) => [
                'id' => $batch->id,
                'product_id' => $batch->product_id,
                'product_name' => $batch->product?->name ?? 'Deleted product',
                'batch_code' => $batch->batch_code,
                'received_quantity' => $batch->received_quantity,
                'remaining_quantity' => $batch->remaining_quantity,
                'expiration_date' => $batch->expiration_date?->toDateString(),
                'note' => $batch->note,
                'received_at' => $batch->created_at?->toISOString(),
            ]);
    }

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

    public function receiveBatch(Request $request)
    {
        $today = now('Asia/Manila')->toDateString();
        $data = $request->validate([
            'product_id' => ['required', 'exists:products,id'],
            'quantity_kg' => ['required', 'integer', 'min:1'],
            'expiration_date' => ['required', 'date', 'after_or_equal:' . $today],
            'batch_code' => ['nullable', 'string', 'max:80', 'unique:inventory_batches,batch_code'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $result = DB::transaction(function () use ($data) {
            $product = Product::whereKey($data['product_id'])->lockForUpdate()->firstOrFail();
            $batch = $product->batches()->create([
                'batch_code' => $data['batch_code'] ?? null,
                'received_quantity' => $data['quantity_kg'],
                'remaining_quantity' => $data['quantity_kg'],
                'expiration_date' => $data['expiration_date'],
                'note' => $data['note'] ?? null,
            ]);
            if (! $batch->batch_code) {
                $batch->update(['batch_code' => 'B-' . str_pad((string) $batch->id, 6, '0', STR_PAD_LEFT)]);
            }
            $product->increment('stock', $data['quantity_kg']);
            $movement = InventoryMovement::create([
                'product_id' => $product->id,
                'product_name' => $product->name,
                'type' => 'Stock In',
                'quantity' => $data['quantity_kg'],
                'reference' => $batch->batch_code,
                'note' => $data['note'] ?? null,
            ]);
            return compact('batch', 'movement');
        });

        return response()->json([
            'id' => $result['batch']->id,
            'product_id' => $result['batch']->product_id,
            'product_name' => Product::find($result['batch']->product_id)?->name,
            'batch_code' => $result['batch']->batch_code,
            'received_quantity' => $result['batch']->received_quantity,
            'remaining_quantity' => $result['batch']->remaining_quantity,
            'expiration_date' => $result['batch']->expiration_date?->toDateString(),
            'note' => $result['batch']->note,
            'received_at' => $result['batch']->created_at?->toISOString(),
            'movement_id' => $result['movement']->id,
            'message' => 'Inventory batch received.',
        ], 201);
    }

    public function updateBatch(Request $request, InventoryBatch $batch)
    {
        $data = $request->validate([
            'remaining_quantity' => ['sometimes', 'required', 'integer', 'min:0'],
            'expiration_date' => ['sometimes', 'nullable', 'date'],
            'batch_code' => ['sometimes', 'nullable', 'string', 'max:80', 'unique:inventory_batches,batch_code,' . $batch->id],
            'note' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);
        if (array_key_exists('batch_code', $data) && ! trim((string) $data['batch_code'])) {
            $baseCode = 'B-' . str_pad((string) $batch->id, 6, '0', STR_PAD_LEFT);
            $generatedCode = $baseCode;
            $suffix = 1;
            while (DB::table('inventory_batches')->where('batch_code', $generatedCode)->where('id', '!=', $batch->id)->exists()) {
                $generatedCode = $baseCode . '-' . $suffix++;
            }
            $data['batch_code'] = $generatedCode;
        }

        $result = DB::transaction(function () use ($data, $batch) {
            $product = Product::whereKey($batch->product_id)->lockForUpdate()->firstOrFail();
            $lockedBatch = InventoryBatch::whereKey($batch->id)->lockForUpdate()->firstOrFail();
            $oldQuantity = (int) $lockedBatch->remaining_quantity;
            $newQuantity = array_key_exists('remaining_quantity', $data) ? (int) $data['remaining_quantity'] : $oldQuantity;
            $delta = $newQuantity - $oldQuantity;

            if ($delta !== 0 && trim((string) ($data['note'] ?? '')) === '') {
                throw ValidationException::withMessages(['note' => ['Enter a reason when correcting the remaining stock quantity.']]);
            }
            if ($product->stock + $delta < 0) {
                throw ValidationException::withMessages(['remaining_quantity' => ['The correction would reduce product stock below zero.']]);
            }

            $lockedBatch->update($data);
            if ($delta !== 0) {
                $product->stock = (int) $product->stock + $delta;
                $product->save();
            }
            $movement = $delta === 0 ? null : InventoryMovement::create([
                'product_id' => $product->id,
                'product_name' => $product->name,
                'type' => 'Batch Adjustment',
                'quantity' => $delta,
                'reference' => $lockedBatch->batch_code,
                'note' => trim($data['note']),
            ]);

            return compact('product', 'lockedBatch', 'movement');
        });

        return response()->json([
            'id' => $result['lockedBatch']->id,
            'product_id' => $result['lockedBatch']->product_id,
            'product_name' => $result['product']->name,
            'batch_code' => $result['lockedBatch']->batch_code,
            'received_quantity' => $result['lockedBatch']->received_quantity,
            'remaining_quantity' => $result['lockedBatch']->remaining_quantity,
            'expiration_date' => $result['lockedBatch']->expiration_date?->toDateString(),
            'note' => $result['lockedBatch']->note,
            'received_at' => $result['lockedBatch']->created_at?->toISOString(),
            'movement_id' => $result['movement']?->id,
            'message' => 'Inventory batch updated.',
        ]);
    }
}
