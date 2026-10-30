<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class ProductController extends Controller
{
    public function index(Request $request)
    {
        $today = now('Asia/Manila')->toDateString();
        return Product::with('supplier')->withSum([
            'batches as available_stock' => fn ($query) => $query
                ->where('remaining_quantity', '>', 0)
                ->where(fn ($query) => $query->whereNull('expiration_date')->orWhereDate('expiration_date', '>=', $today)),
        ], 'remaining_quantity')->orderBy('name')->get()->map(fn (Product $product) => $this->payload($product));
    }

    public function show(Request $request, Product $product)
    {
        $product->load('supplier');

        return response()->json($this->payload($product));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'sku' => ['nullable', 'string', 'max:40', 'unique:products,sku'],
            'name' => ['required', 'string', 'max:160', 'unique:products,name'],
            'category' => ['required', 'string', 'max:80'],
            'price' => ['required', 'numeric', 'min:0'],
            'reorder_level' => ['required', 'integer', 'min:0'],
            'is_best_seller' => ['sometimes', 'boolean'],
            'supplier_id' => ['nullable', 'exists:suppliers,id'],
        ]);
        $data['stock'] = 0;
        $data['sku'] = ($data['sku'] ?? null) ?: 'FS-' . Str::upper(Str::random(8));
        $product = Product::create($data)->load('supplier');
        return response()->json($this->payload($product), 201);
    }

    public function update(Request $request, Product $product)
    {
        $data = $request->validate([
            'sku' => ['sometimes', 'nullable', 'string', 'max:40', 'unique:products,sku,' . $product->id],
            'name' => ['sometimes', 'required', 'string', 'max:160', 'unique:products,name,' . $product->id],
            'category' => ['sometimes', 'required', 'string', 'max:80'],
            'price' => ['sometimes', 'required', 'numeric', 'min:0'],
            'reorder_level' => ['sometimes', 'required', 'integer', 'min:0'],
            'is_best_seller' => ['sometimes', 'boolean'],
            'supplier_id' => ['sometimes', 'nullable', 'exists:suppliers,id'],
        ]);
        $product->update($data);
        return response()->json($this->payload($product->fresh('supplier')));
    }

    public function destroy(Product $product)
    {
        $product->delete();
        return response()->json(['message' => 'Product deleted.']);
    }

    private function payload(Product $product, bool $includeSupplier = true): array
    {
        $payload = $product->toArray();
        if (!$includeSupplier) {
            unset($payload['supplier'], $payload['supplier_id']);
        }

        return [
            ...$payload,
            'available_stock' => (int) ($product->available_stock ?? $product->stock),
            'supplier_name' => $includeSupplier ? ($product->supplier?->name ?? '') : '',
        ];
    }
}
