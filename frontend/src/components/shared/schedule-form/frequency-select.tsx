import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FrequencySelectProps<T extends string> = {
  id: string;
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
};

export function FrequencySelect<T extends string>({
  id,
  value,
  labels,
  onChange,
}: FrequencySelectProps<T>) {
  return (
    <div className='flex flex-col gap-2'>
      <Label id={`${id}-label`} htmlFor={id}>
        Frequência
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as T);
        }}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          className='rounded-lg'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(labels).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label as string}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
