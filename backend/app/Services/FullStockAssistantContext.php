<?php

namespace App\Services;

use App\Models\InventoryMovement;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Supplier;
use Illuminate\Support\Carbon;

class FullStockAssistantContext
{
    /**
     * Build a small, question-focused slice of the live workspace data.
     * Sending every transaction and stock movement on every turn can make a
     * local model spend minutes reading data that is unrelated to the question.
     */
    public function snapshotForQuestion(string $question): array
    {
        $question = mb_strtolower(trim($question));
        $base = [
            'generated_at' => now()->toIso8601String(),
            'rules' => [
                'low_stock' => 'stock_units is at or below reorder_level_units',
                'out_of_stock' => 'stock_units is zero',
                'sale_price' => 'sales use the current administrator-managed product price',
                'sale_stock_effect' => 'completed sales reduce product stock',
            ],
        ];

        if (preg_match('/\b(low[- ]?stock|out of stock|running low|run(?:ning)? out|avoid.*run(?:ning)? out|prevent.*out of stock|below (?:the )?reorder|at or below.*reorder|need.*restock|should.*restock|kailangan.*restock|restock priority|mababa.*stock|ubos na|malapit maubos)\b/u', $question)) {
            $items = Product::query()
                ->whereColumn('stock', '<=', 'reorder_level')
                ->orderBy('stock')
                ->orderBy('name')
                ->get(['name', 'category', 'stock', 'reorder_level'])
                ->map(fn (Product $product) => [
                    'name' => $product->name,
                    'category' => $product->category,
                    'stock_units' => (int) $product->stock,
                    'reorder_level_units' => (int) $product->reorder_level,
                    'status' => $product->stock <= 0 ? 'out of stock' : 'low stock',
                ])->all();
            $catalog = Product::with('supplier:id,name')
                ->orderBy('name')
                ->get(['id', 'name', 'category', 'price', 'stock', 'reorder_level', 'supplier_id'])
                ->map(fn (Product $product) => [
                    'id' => $product->id,
                    'name' => $product->name,
                    'category' => $product->category,
                    'price_php' => (float) $product->price,
                    'stock_units' => (int) $product->stock,
                    'reorder_level_units' => (int) $product->reorder_level,
                    'status' => $product->stock <= 0
                        ? 'out of stock'
                        : ($product->stock <= $product->reorder_level ? 'low stock' : 'in stock'),
                    'supplier' => $product->supplier?->name,
                ])->all();

            return $base + [
                'scope' => 'Only products currently at or below their reorder level are included.',
                'products' => [
                    'total_count' => Product::count(),
                    'low_stock_count' => count($items),
                    'matching_count' => count($items),
                    'items' => $items,
                    'catalog_items' => $catalog,
                ],
            ];
        }

        if (preg_match('/\bhow (?:do|can|should) i\b|\bhow to\b|\bpaano(?: ko)?\b/u', $question)
            && preg_match('/\b(sale|sales|sell|sold|benta|nabenta)\b/u', $question)) {
            return $base + [
                'scope' => 'This is a workflow question; no transaction lookup is needed.',
            ];
        }

        if (preg_match('/\b(movement|movements|restock|restocked|adjustment|stock change|inventory history|galaw ng stock)\b/u', $question)
            || (preg_match('/\bhistory\b/u', $question) && preg_match('/\b(inventory|stock)\b/u', $question))) {
            return $base + [
                'scope' => 'Recent recorded inventory movements.',
                'inventory_movements' => [
                    'total_count' => InventoryMovement::count(),
                    'recent' => InventoryMovement::query()
                        ->latest()
                        ->limit(20)
                        ->get(['created_at', 'product_id', 'product_name', 'type', 'quantity', 'reference', 'note'])
                        ->map(fn (InventoryMovement $movement) => [
                            'date' => $movement->created_at?->toIso8601String(),
                            'product_id' => $movement->product_id,
                            'product' => $movement->product_name,
                            'type' => $movement->type,
                            'quantity' => (int) $movement->quantity,
                            'reference' => $movement->reference,
                            'note' => $movement->note,
                        ])->all(),
                ],
            ];
        }

        if (preg_match('/\b(sale|sales|sell|sold|revenue|transaction|top[- ]selling|best[- ]selling|fastest[- ]selling|most sold|popular|pinakamabenta|pinakamarami|benta|nabenta|kita|kinita)\b/u', $question)) {
            $now = now();
            $periodKey = match (true) {
                preg_match('/\b(today|this day|ngayon|araw na ito)\b/u', $question) === 1 => 'today',
                preg_match('/\b(this week|week to date|weekly|linggong ito)\b/u', $question) === 1 => 'this_week',
                preg_match('/\b(last 7 days|past 7 days)\b/u', $question) === 1 => 'last_7_days',
                preg_match('/\b(this month|month to date|monthly|buwang ito)\b/u', $question) === 1 => 'this_month',
                preg_match('/\b(last month|previous month|last calendar month|previous calendar month)\b/u', $question) === 1 => 'last_month',
                preg_match('/\b(last 30 days|past 30 days)\b/u', $question) === 1 => 'last_30_days',
                preg_match('/\b(yesterday|kahapon)\b/u', $question) === 1 => 'yesterday',
                default => 'all_time',
            };
            $previousMonthStart = $now->copy()->subMonthNoOverflow()->startOfMonth();
            $since = match ($periodKey) {
                'today' => $now->copy()->startOfDay(),
                'this_week' => $now->copy()->startOfWeek(),
                'last_7_days' => $now->copy()->subDays(7),
                'this_month' => $now->copy()->startOfMonth(),
                'last_month' => $previousMonthStart,
                'yesterday' => $now->copy()->subDay()->startOfDay(),
                'last_30_days' => $now->copy()->subDays(30),
                default => null,
            };
            $until = match ($periodKey) {
                'last_month' => $previousMonthStart->copy()->endOfMonth(),
                'yesterday' => $now->copy()->subDay()->endOfDay(),
                default => null,
            };
            $summary = $this->salesSummary($since, $until);
            $sales = [
                'period' => $periodKey,
                'period_summaries' => [$periodKey => $summary],
                'product_performance' => $this->productPerformance($since, $until),
                'product_catalog' => Product::with('supplier:id,name')
                    ->orderBy('name')
                    ->get(['id', 'name', 'category', 'price', 'stock', 'reorder_level', 'supplier_id'])
                    ->map(fn (Product $product) => [
                        'id' => $product->id,
                        'name' => $product->name,
                        'category' => $product->category,
                        'price_php' => (float) $product->price,
                        'stock_units' => (int) $product->stock,
                        'reorder_level_units' => (int) $product->reorder_level,
                        'status' => $product->stock <= 0
                            ? 'out of stock'
                            : ($product->stock <= $product->reorder_level ? 'low stock' : 'in stock'),
                        'supplier' => $product->supplier?->name,
                    ])->all(),
            ];

            if ($periodKey === 'all_time') {
                $sales['total_transactions'] = $summary['transactions'];
            }
            if (preg_match('/\b(top|best|most|popular|fastest|pinakamarami|pinakamabenta)\b/u', $question)) {
                $listKey = match ($periodKey) {
                    'today' => 'top_products_today',
                    'this_week' => 'top_products_this_week',
                    'last_7_days' => 'top_products_last_7_days',
                    'this_month' => 'top_products_this_month',
                    'last_month' => 'top_products_last_month',
                    'yesterday' => 'top_products_yesterday',
                    'last_30_days' => 'top_products_last_30_days',
                    default => 'top_products_all_time',
                };
                $sales[$listKey] = array_slice($sales['product_performance'], 0, 10);
            }
            if (preg_match('/\b(recent|latest|last sale|transaction|receipt|yesterday|kahapon|ngayon|what did we sell|what was sold)\b/u', $question)) {
                $sales['recent_transactions'] = Sale::with('items')
                    ->whereNull('voided_at')
                    ->when($since, fn ($query) => $query->where('sold_at', '>=', $since))
                    ->when($until, fn ($query) => $query->where('sold_at', '<=', $until))
                    ->latest('sold_at')
                    ->limit(10)
                    ->get()
                    ->map(fn (Sale $sale) => [
                        'sale_number' => $sale->sale_number,
                        'sold_at' => $sale->sold_at?->toIso8601String(),
                        'total_php' => (float) $sale->total,
                        'status' => $sale->status,
                        'items' => $sale->items->map(fn ($item) => [
                            'product' => $item->product_name,
                            'quantity' => (int) $item->quantity,
                            'unit_price_php' => (float) $item->unit_price,
                            'line_total_php' => (float) $item->line_total,
                        ])->values()->all(),
                    ])->values()->all();
            }

            return $base + [
                'scope' => 'Sales summaries and rankings come from current saved sales records. Recent transactions are included only when the question asks for them.',
                'sales' => $sales,
            ];
        }

        if (preg_match('/\b(supplier|suppliers|vendor|vendors|tagapagtustos)\b/u', $question)) {
            $suppliers = Supplier::withCount('products')
                ->orderBy('name')
                ->limit(100)
                ->get(['id', 'name', 'contact', 'email']);

            return $base + [
                'scope' => 'Supplier details and current product-to-supplier assignments.',
                'suppliers' => [
                    'total_count' => Supplier::count(),
                    'items' => $suppliers->map(fn (Supplier $supplier) => [
                        'name' => $supplier->name,
                        'contact' => $supplier->contact,
                        'email' => $supplier->email,
                        'products_supplied_count' => $supplier->products_count,
                    ])->all(),
                ],
                'products' => [
                    'items' => Product::with('supplier:id,name')->orderBy('name')->limit(200)->get(['id', 'name', 'category', 'price', 'stock', 'reorder_level', 'supplier_id'])
                        ->map(fn (Product $product) => [
                            'id' => $product->id,
                            'name' => $product->name,
                            'category' => $product->category,
                            'price_php' => (float) $product->price,
                            'stock_units' => (int) $product->stock,
                            'reorder_level_units' => (int) $product->reorder_level,
                            'status' => $product->stock <= 0 ? 'out of stock' : ($product->stock <= $product->reorder_level ? 'low stock' : 'in stock'),
                            'supplier' => $product->supplier?->name,
                        ])
                        ->all(),
                ],
            ];
        }

        if (preg_match('/\b(product|products|rice|item|items|stock|inventory|price|category|reorder level|reorder point|reorder|kategorya|bigas|presyo|natitira|ilang)\b/u', $question)) {
            $query = Product::query()->with('supplier:id,name')->orderBy('name');
            $products = $query->limit(200)->get();

            return $base + [
                'scope' => 'Current complete product catalog, prices, stock, and supplier assignments.',
                'products' => [
                    'total_count' => Product::count(),
                    'included_count' => $products->count(),
                    'truncated' => Product::count() > $products->count(),
                    'units_on_hand' => (int) Product::sum('stock'),
                    'low_stock_count' => Product::whereColumn('stock', '<=', 'reorder_level')->count(),
                    'out_of_stock_count' => Product::where('stock', '<=', 0)->count(),
                    'items' => $products->map(fn (Product $product) => [
                        'id' => $product->id,
                        'name' => $product->name,
                        'category' => $product->category,
                        'price_php' => (float) $product->price,
                        'stock_units' => (int) $product->stock,
                        'reorder_level_units' => (int) $product->reorder_level,
                        'status' => $product->stock <= 0
                            ? 'out of stock'
                            : ($product->stock <= $product->reorder_level ? 'low stock' : 'in stock'),
                        'supplier' => $product->supplier?->name,
                    ])->all(),
                ],
            ];
        }

        $lowStock = Product::query()
            ->whereColumn('stock', '<=', 'reorder_level')
            ->orderBy('stock')
            ->limit(20)
            ->get(['name', 'category', 'stock', 'reorder_level'])
            ->map(fn (Product $product) => [
                'name' => $product->name,
                'category' => $product->category,
                'stock_units' => (int) $product->stock,
                'reorder_level_units' => (int) $product->reorder_level,
            ])->all();
        $now = now();

        return $base + [
            'scope' => 'Compact business overview for general questions.',
            'products' => [
                'total_count' => Product::count(),
                'low_stock_count' => Product::whereColumn('stock', '<=', 'reorder_level')->count(),
                'out_of_stock_count' => Product::where('stock', '<=', 0)->count(),
                'units_on_hand' => (int) Product::sum('stock'),
                'low_stock_items' => $lowStock,
            ],
            'sales' => [
                'total_transactions' => Sale::whereNull('voided_at')->count(),
                'period_summaries' => [
                    'today' => $this->salesSummary($now->copy()->startOfDay()),
                    'this_week' => $this->salesSummary($now->copy()->startOfWeek()),
                    'this_month' => $this->salesSummary($now->copy()->startOfMonth()),
                    'last_month' => $this->salesSummary(
                        $now->copy()->subMonthNoOverflow()->startOfMonth(),
                        $now->copy()->subMonthNoOverflow()->endOfMonth(),
                    ),
                ],
            ],
            'suppliers' => ['total_count' => Supplier::count()],
        ];
    }

    public function snapshot(): array
    {
        $productCount = Product::count();
        $products = Product::with('supplier:id,name')
            ->orderBy('name')
            ->limit(500)
            ->get()
            ->map(fn (Product $product) => [
                'id' => $product->id,
                'name' => $product->name,
                'category' => $product->category,
                'price_php' => (float) $product->price,
                'stock_units' => (int) $product->stock,
                'reorder_level_units' => (int) $product->reorder_level,
                'status' => $product->stock <= 0
                    ? 'out of stock'
                    : ($product->stock <= $product->reorder_level ? 'low stock' : 'in stock'),
                'supplier' => $product->supplier?->name,
            ])->values();

        $supplierCount = Supplier::count();
        $suppliers = Supplier::withCount('products')
            ->orderBy('name')
            ->limit(200)
            ->get()
            ->map(fn (Supplier $supplier) => [
                'name' => $supplier->name,
                'contact' => $supplier->contact,
                'email' => $supplier->email,
                'products_supplied_count' => $supplier->products_count,
            ])->values();

        $salesCount = Sale::whereNull('voided_at')->count();
        $now = now();

        return [
            'generated_at' => $now->toIso8601String(),
            'rules' => [
                'low_stock' => 'stock_units is at or below reorder_level_units',
                'out_of_stock' => 'stock_units is zero',
                'sale_price' => 'sales use the current administrator-managed product price',
                'sale_stock_effect' => 'completed sales reduce product stock',
            ],
            'products' => [
                'total_count' => $productCount,
                'included_count' => $products->count(),
                'truncated' => $productCount > $products->count(),
                'items' => $products->all(),
            ],
            'sales' => [
                'total_transactions' => $salesCount,
                'period_summaries' => [
                    'all_time' => $this->salesSummary(),
                    'today' => $this->salesSummary($now->copy()->startOfDay()),
                    'last_7_days' => $this->salesSummary($now->copy()->subDays(7)),
                    'last_30_days' => $this->salesSummary($now->copy()->subDays(30)),
                ],
                'top_products_all_time' => $this->topProducts(),
                'top_products_last_30_days' => $this->topProducts($now->copy()->subDays(30)),
                'recent_transactions' => Sale::with('items')
                    ->whereNull('voided_at')
                    ->latest('sold_at')
                    ->limit(40)
                    ->get()
                    ->map(fn (Sale $sale) => [
                        'sale_number' => $sale->sale_number,
                        'sold_at' => $sale->sold_at?->toIso8601String(),
                        'total_php' => (float) $sale->total,
                        'status' => $sale->status,
                        'items' => $sale->items->map(fn ($item) => [
                            'product_id' => $item->product_id,
                            'product' => $item->product_name,
                            'quantity' => (int) $item->quantity,
                            'unit_price_php' => (float) $item->unit_price,
                            'line_total_php' => (float) $item->line_total,
                        ])->values()->all(),
                    ])->values()->all(),
            ],
            'suppliers' => [
                'total_count' => $supplierCount,
                'included_count' => $suppliers->count(),
                'truncated' => $supplierCount > $suppliers->count(),
                'items' => $suppliers->all(),
            ],
            'inventory_movements' => [
                'total_count' => InventoryMovement::count(),
                'recent' => InventoryMovement::latest()
                    ->limit(50)
                    ->get()
                    ->map(fn (InventoryMovement $movement) => [
                        'date' => $movement->created_at?->toIso8601String(),
                        'product_id' => $movement->product_id,
                        'product' => $movement->product_name,
                        'type' => $movement->type,
                        'quantity' => (int) $movement->quantity,
                        'reference' => $movement->reference,
                    ])->values()->all(),
            ],
        ];
    }

    private function salesSummary(?Carbon $since = null, ?Carbon $until = null): array
    {
        $summary = Sale::query()
            ->whereNull('voided_at')
            ->when($since, fn ($query) => $query->where('sold_at', '>=', $since))
            ->when($until, fn ($query) => $query->where('sold_at', '<=', $until))
            ->selectRaw('COUNT(*) as transactions, COALESCE(SUM(total), 0) as revenue_php')
            ->first();

        return [
            'transactions' => (int) $summary->transactions,
            'revenue_php' => (float) $summary->revenue_php,
        ];
    }

    private function topProducts(?Carbon $since = null): array
    {
        return array_slice($this->productPerformance($since), 0, 10);
    }

    private function productPerformance(?Carbon $since = null, ?Carbon $until = null): array
    {
        return SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->whereNull('sales.voided_at')
            ->when($since, fn ($query) => $query->where('sales.sold_at', '>=', $since))
            ->when($until, fn ($query) => $query->where('sales.sold_at', '<=', $until))
            ->select('sale_items.product_name')
            ->selectRaw('SUM(sale_items.quantity) as units_sold, SUM(sale_items.line_total) as revenue_php')
            ->groupBy('sale_items.product_name')
            ->orderByDesc('units_sold')
            ->get()
            ->map(fn ($item) => [
                'product' => $item->product_name,
                'units_sold' => (int) $item->units_sold,
                'revenue_php' => (float) $item->revenue_php,
            ])->all();
    }
}
