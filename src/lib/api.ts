import { slugify } from './slug';

const TOKEN = 'qbxm2tn9';
const API_URL = 'https://api.indianluxurycars.com/rest/';

export type UsedCar = {
  id: number;
  used_car_id: number;
  used_car_sku_id: string;
  price: number;
  formatted_price: string;
  msp: number;
  myear: number;
  model: string;
  variant_name: string;
  oem: string;
  km: string;
  fuel_type: string;
  transmission_type: string;
  city: string;
  city_id: number;
  locality: string;
  location: string;
  body_type: string;
  owner: number;
  owner_slug: string;
  dealer_id: number;
  active: number;
  inventory_status: number;
  inventory_type_label: string;
  car_type: string;
  corporate_id: number;
  store_id: string;
  utype: string;
  vlink: string;
  from_url: string;
  created_at: string;
  updated_at: string;
  // Enhanced fields
  image_url?: string;
  images?: string[];
  condition?: string;
  description?: string;
};

async function getCarImages(used_car_id: number): Promise<string[]> {
  try {
    const response = await fetch(
      `${API_URL}car_images?used_car_id=${used_car_id}&limit=1000`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch images for car ${used_car_id}: ${response.status}`
      );
      return [];
    }

    const data = await response.json();
    const images = Array.isArray(data) ? data : data.results || [];

    if (images.length === 0) {
      return [];
    }

    const imageUrls = images
      .map((img: any) => {
        if (typeof img === 'string') {
          return img;
        }
        return img.image_url || img.url || img.src || null;
      })
      .filter(Boolean);

    return imageUrls;
  } catch (e) {
    console.error(`Error fetching images for car ${used_car_id}:`, e);
    return [];
  }
}

export async function getAllUsedCars(): Promise<UsedCar[]> {
  try {
    const response = await fetch(
      `${API_URL}used_cars?sort_by=created_at&order=desc`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch all cars: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const cars = Array.isArray(data) ? data : data.results || [];

    const carsWithImages = await Promise.all(
      cars.map(async (car: any) => {
        const images = await getCarImages(car.used_car_id);
        return {
          ...car,
          image_url: images.length > 0 ? images[0] : undefined,
          images,
        };
      })
    );

    return carsWithImages;
  } catch (e) {
    console.error('Error fetching all cars:', e);
    return [];
  }
}

export type FetchCarsOptions = {
  limit?: number;
  offset?: number;
  sort_by?: string;
  order?: 'asc' | 'desc';
  city?: string;
  oem?: string;
  model?: string;
  body_type?: string;
  fuel_type?: string;
  // We can add more specific filters here if needed
  [key: string]: string | number | undefined;
};

export type FetchCarsResult = {
  success: boolean;
  results: UsedCar[];
  meta: {
    total?: number;
    [key: string]: any;
  };
};

export async function getCars(
  options: FetchCarsOptions = {}
): Promise<FetchCarsResult> {
  const queryParams = new URLSearchParams();

  if (options.city) {
    queryParams.append('city', options.city);
  }
  if (options.oem) {
    queryParams.append('oem', options.oem);
  }
  if (options.model) {
    queryParams.append('model', options.model);
  }
  if (options.body_type) {
    queryParams.append('body_type', options.body_type);
  }
  if (options.fuel_type) {
    queryParams.append('fuel_type', options.fuel_type);
  }

  const sortCol = options.sort_by === 'price' ? 'price' : 'created_at';
  const sortOrder = options.order === 'asc' ? 'asc' : 'desc';
  queryParams.append('sort_by', sortCol);
  queryParams.append('order', sortOrder);

  const limit = options.limit || 24;
  const offset = options.offset || 0;
  queryParams.append('limit', limit.toString());
  queryParams.append('offset', offset.toString());

  try {
    const response = await fetch(
      `${API_URL}used_cars?${queryParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      console.error(
        `Failed to fetch cars: ${response.status} ${response.statusText}`
      );
      return { success: false, results: [], meta: {} };
    }

    const data = await response.json();
    const cars = Array.isArray(data) ? data : data.results || [];

    const carsWithImages = await Promise.all(
      cars.map(async (car: any) => {
        const images = await getCarImages(car.used_car_id);
        return {
          ...car,
          image_url: images.length > 0 ? images[0] : undefined,
          images,
        };
      })
    );

    return {
      success: true,
      results: carsWithImages,
      meta: data.meta || { total: cars.length },
    };
  } catch (error) {
    console.error('Error fetching cars:', error);
    return { success: false, results: [], meta: {} };
  }
}

export async function getFilterOptions(): Promise<{
  oems: string[];
  cities: string[];
  bodyTypes: string[];
  fuelTypes: string[];
}> {
  try {
    const response = await fetch(`${API_URL}used_cars?limit=10000`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch filter options');
      return { oems: [], cities: [], bodyTypes: [], fuelTypes: [] };
    }

    const data = await response.json();
    const cars = Array.isArray(data) ? data : data.results || [];

    const oemsSet = new Set<string>();
    const citiesSet = new Set<string>();
    const bodyTypesSet = new Set<string>();
    const fuelTypesSet = new Set<string>();

    for (const car of cars) {
      if (car.oem) oemsSet.add(car.oem);
      if (car.city) citiesSet.add(car.city);
      if (car.body_type) bodyTypesSet.add(car.body_type);
      if (car.fuel_type) fuelTypesSet.add(car.fuel_type);
    }

    return {
      oems: Array.from(oemsSet).sort(),
      cities: Array.from(citiesSet).sort(),
      bodyTypes: Array.from(bodyTypesSet).sort(),
      fuelTypes: Array.from(fuelTypesSet).sort(),
    };
  } catch (e) {
    console.error('Error fetching filter options:', e);
    return { oems: [], cities: [], bodyTypes: [], fuelTypes: [] };
  }
}

export async function getCarDetails(
  used_car_id: number
): Promise<UsedCar | null> {
  try {
    const response = await fetch(
      `${API_URL}used_cars?used_car_id=${used_car_id}&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const cars = Array.isArray(data) ? data : data.results || [];
    if (cars.length === 0) return null;

    const car = cars[0];
    const images = await getCarImages(used_car_id);
    return {
      ...car,
      image_url: images.length > 0 ? images[0] : undefined,
      images,
    };
  } catch (e) {
    console.error('Error fetching car details:', e);
    return null;
  }
}

export async function getCarByRowId(id: number): Promise<UsedCar | null> {
  try {
    let response = await fetch(`${API_URL}used_cars/${id}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    if (!response.ok) {
      response = await fetch(`${API_URL}used_cars?id=${id}&limit=1`, {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      });
    }

    if (!response.ok) {
      console.error(
        `Failed to fetch car by id ${id}: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    let car;
    if (Array.isArray(data)) {
      car = data.length > 0 ? data[0] : null;
    } else if (data.results && Array.isArray(data.results)) {
      car = data.results.length > 0 ? data.results[0] : null;
    } else {
      car = data;
    }

    if (!car || !car.used_car_id) {
      console.error(`Car data invalid for id ${id}:`, car);
      return null;
    }

    const images = await getCarImages(car.used_car_id);
    return {
      ...car,
      image_url: images.length > 0 ? images[0] : undefined,
      images,
    };
  } catch (e) {
    console.error(`Error fetching car by row id ${id}:`, e);
    return null;
  }
}

export function generateCarSlug(car: UsedCar): string {
  // Pattern: make-model-year-city-id
  // e.g. kia-sonet-2024-rajkot-365
  const parts = [
    car.oem,
    car.model,
    car.myear.toString(),
    car.city,
    car.id.toString(),
  ];
  return slugify(parts.join(' '));
}
