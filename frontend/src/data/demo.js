export const riceCatalog = [
  { category: 'Short-Grain Rice', products: ['Koshihikari Rice', 'Sasanishiki Rice', 'Akitakomachi Rice', 'Japanese Sushi Rice', 'Japonica Rice'] },
  { category: 'Medium-Grain Rice', products: ['Calrose Rice', 'Doña Maria Jasponica Rice', 'Doña Maria Miponica Rice', 'Arborio Rice', 'Japanese Medium-Grain Rice'] },
  { category: 'Long-Grain Rice', products: ['Sinandomeng Rice', 'Dinorado Rice', 'Jasmine Rice', 'Basmati Rice', 'Parboiled Long-Grain Rice'] },
]

const legacyDemoProducts = [
  { id: 1, name: 'Iced Coffee' }, { id: 2, name: 'Burger' }, { id: 3, name: 'Fries' },
  { id: 4, name: 'Sandwich' }, { id: 5, name: 'Pasta' }, { id: 6, name: 'Milk Tea' },
]

export const starterData = {
  products: riceCatalog.flatMap(({ category, products }) => products.map((name) => ({
    name,
    category,
    price: 0,
    stock: 0,
    reorder_level: 5,
    supplier_id: null,
    supplier_name: '',
  }))).map((product, index) => ({ id: index + 1, ...product })),
  suppliers: [],
  sales: [],
  movements: [],
}

export function readStoredData() {
  try {
    const saved = JSON.parse(localStorage.getItem('fullstock_data'))
    if (saved) {
      const workspace = { ...saved }
      delete workspace.customers
      const savedProducts = Array.isArray(workspace.products) ? workspace.products : []
      const isLegacyDemoCatalog = savedProducts.length > 0 && savedProducts.length <= legacyDemoProducts.length && savedProducts.every((product) => legacyDemoProducts.some((legacy) => legacy.id === product.id && legacy.name === product.name))
      const riceCategories = new Set(riceCatalog.map((group) => group.category))
      const catalogRiceNames = new Set(riceCatalog.flatMap((group) => group.products))
      const isOutdatedCatalog = savedProducts.some((product) => !riceCategories.has(product.category))
      if (isLegacyDemoCatalog || isOutdatedCatalog) {
        const existingByName = new Map(savedProducts.filter((product) => riceCatalog.some((group) => group.products.includes(product.name))).map((product) => [product.name, product]))
        if (existingByName.size) {
          let generatedId = Math.max(0, ...savedProducts.map((product) => Number(product.id)).filter(Number.isFinite)) + 1
          workspace.products = starterData.products.map((product) => {
            const existing = existingByName.get(product.name)
            return existing
              ? { ...product, ...existing, name: product.name, category: product.category }
              : { ...product, id: generatedId++ }
          })
        } else {
          workspace.products = starterData.products
        }

        const customRiceProducts = savedProducts.filter((product) => riceCategories.has(product.category) && !catalogRiceNames.has(product.name))
        let nextId = Math.max(0, ...savedProducts.map((product) => Number(product.id)).filter(Number.isFinite), ...workspace.products.map((product) => Number(product.id)).filter(Number.isFinite)) + 1
        const usedIds = new Set(workspace.products.map((product) => String(product.id)))
        workspace.products.push(...customRiceProducts.map((product) => {
          const id = product.id != null && !usedIds.has(String(product.id)) ? product.id : nextId++
          usedIds.add(String(id))
          return { ...product, id }
        }))

        if (isLegacyDemoCatalog && Array.isArray(workspace.suppliers) && workspace.suppliers.length === 3 && ['ABC Supplies', 'Fresh Foods Co.', 'Beverage Corp.'].every((name) => workspace.suppliers.some((supplier) => supplier.name === name))) {
          workspace.suppliers = starterData.suppliers
        }
        if (isLegacyDemoCatalog && Array.isArray(workspace.sales) && workspace.sales.length === 4 && ['S-1042', 'S-1041', 'S-1040', 'S-1039'].every((saleNumber) => workspace.sales.some((sale) => sale.number === saleNumber))) {
          workspace.sales = starterData.sales
        }
        if (isLegacyDemoCatalog && Array.isArray(workspace.movements) && workspace.movements.length === 4 && ['Sale #S-1042', 'Purchase #PO-001', 'Sale #S-1040'].every((reference) => workspace.movements.some((movement) => movement.reference === reference))) {
          workspace.movements = starterData.movements
        }
      }
      if (Array.isArray(workspace.products)) {
        workspace.products = workspace.products.map((product) => {
          const cleanProduct = { ...product }
          delete cleanProduct.sku
          return cleanProduct
        })
      }
      const riceProductNames = new Set([
        ...riceCatalog.flatMap((group) => group.products),
        ...(Array.isArray(workspace.products) ? workspace.products.map((product) => product.name) : []),
      ])
      if (Array.isArray(workspace.sales)) {
        workspace.sales = workspace.sales.filter((sale) => Array.isArray(sale.items)
          && sale.items.length > 0
          && sale.items.every((item) => riceProductNames.has(item.product_name)))
      }
      if (Array.isArray(workspace.movements)) {
        workspace.movements = workspace.movements.filter((movement) => riceProductNames.has(movement.product_name))
      }
      if (Array.isArray(workspace.sales)) {
        workspace.sales = workspace.sales.map((sale) => {
          const cleanSale = { ...sale }
          delete cleanSale.customer_id
          delete cleanSale.customer_name
          return cleanSale
        })
      }
      return { ...starterData, ...workspace }
    }
  } catch {
    // Ignore invalid local demo data and restore the starter records.
  }
  return starterData
}
