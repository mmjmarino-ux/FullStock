<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Supplier;
use Illuminate\Http\Request;

class SupplierController extends Controller
{
    public function index()
    {
        return Supplier::withCount('products')->orderBy('name')->get()->map(fn (Supplier $supplier) => [...$supplier->toArray(), 'product_count' => $supplier->products_count]);
    }

    public function show(Supplier $supplier)
    {
        return response()->json($supplier->loadCount('products'));
    }

    public function store(Request $request)
    {
        $supplier = Supplier::create($request->validate([
            'name' => ['required', 'string', 'max:160'],
            'contact' => ['nullable', 'string', 'max:80'],
            'email' => ['nullable', 'email', 'max:255'],
            'products' => ['nullable', 'string', 'max:255'],
        ]));
        return response()->json($supplier, 201);
    }

    public function update(Request $request, Supplier $supplier)
    {
        $supplier->update($request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:160'],
            'contact' => ['sometimes', 'nullable', 'string', 'max:80'],
            'email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'products' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]));
        return response()->json($supplier->fresh());
    }

    public function destroy(Supplier $supplier)
    {
        $supplier->delete();
        return response()->json(['message' => 'Supplier deleted.']);
    }
}
