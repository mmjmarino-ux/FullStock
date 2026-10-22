<?php

namespace Database\Seeders;

use App\Models\Product;
use App\Models\InventoryMovement;
use App\Models\Sale;
use App\Models\SaleItem;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class RiceCatalogSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $catalog = [
            'Short-Grain Rice' => ['Koshihikari Rice', 'Sasanishiki Rice', 'Akitakomachi Rice', 'Japanese Sushi Rice', 'Japonica Rice'],
            'Medium-Grain Rice' => ['Calrose Rice', 'Doña Maria Jasponica Rice', 'Doña Maria Miponica Rice', 'Arborio Rice', 'Japanese Medium-Grain Rice'],
            'Long-Grain Rice' => ['Sinandomeng Rice', 'Dinorado Rice', 'Jasmine Rice', 'Basmati Rice', 'Parboiled Long-Grain Rice'],
        ];
        $categoryByName = [];
        foreach ($catalog as $category => $names) {
            foreach ($names as $name) {
                $categoryByName[$name] = $category;
            }
        }

        DB::transaction(function () use ($catalog, $categoryByName): void {
            $riceNames = array_keys($categoryByName);
            $staleSaleItems = static fn () => SaleItem::query()->where(function ($query) use ($riceNames): void {
                $query->whereNull('product_name')->orWhereNotIn('product_name', $riceNames);
            });
            $affectedSaleIds = $staleSaleItems()->pluck('sale_id')->unique()->values();

            // Remove legacy non-rice transaction details while keeping valid rice sale history.
            $staleSaleItems()->delete();
            InventoryMovement::query()->where(function ($query) use ($riceNames): void {
                $query->whereNull('product_name')->orWhereNotIn('product_name', $riceNames);
            })->delete();

            if ($affectedSaleIds->isNotEmpty()) {
                Sale::query()->whereIn('id', $affectedSaleIds)->with('items')->get()->each(function (Sale $sale): void {
                    if ($sale->items->isEmpty()) {
                        $sale->delete();
                        return;
                    }

                    $sale->update(['total' => $sale->items->sum(fn (SaleItem $item) => (float) $item->line_total)]);
                });
            }

            $existingRice = [];
            Product::query()->orderBy('id')->get()->each(function (Product $product) use (&$existingRice, $categoryByName): void {
                $category = $categoryByName[$product->name] ?? null;
                if ($category === null || isset($existingRice[$product->name])) {
                    // Historical sale and movement snapshots remain; only their optional product links are cleared.
                    $product->delete();
                    return;
                }

                $product->update([
                    'category' => $category,
                    // Temporarily free old catalog SKUs before assigning the normalized sequence below.
                    'sku' => 'RICE-MIGRATE-'.$product->id,
                ]);
                $existingRice[$product->name] = $product;
            });

            $sequence = 0;
            foreach ($catalog as $category => $names) {
                foreach ($names as $name) {
                    $sequence++;
                    $attributes = [
                        'sku' => sprintf('RICE-%04d', $sequence),
                        'name' => $name,
                        'category' => $category,
                    ];
                    $product = $existingRice[$name] ?? null;

                    if ($product) {
                        // Matching rice items keep their real price, stock, reorder level, and supplier.
                        $product->update($attributes);
                        continue;
                    }

                    Product::create($attributes + [
                        'price' => 0,
                        'stock' => 0,
                        'reorder_level' => 5,
                        'supplier_id' => null,
                    ]);
                }
            }

            // Reattach valid rice history whose product link was cleared by an earlier catalog reset.
            foreach ($categoryByName as $name => $category) {
                $product = Product::query()->where('category', $category)->where('name', $name)->first();
                SaleItem::query()->whereNull('product_id')->where('product_name', $name)->update(['product_id' => $product->id]);
                InventoryMovement::query()->whereNull('product_id')->where('product_name', $name)->update(['product_id' => $product->id]);
            }
        });
    }
}
