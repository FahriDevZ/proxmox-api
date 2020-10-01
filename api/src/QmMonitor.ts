import { Proxmox } from './model';

// 'mem', // ERROR: VM XXX qmp command 'human-monitor-command' failed - got timeout
// 'tlb', // ERROR: VM XXX qmp command 'human-monitor-command' failed - got timeout

export const VALID_QEMU_INFO_SIMPLE = ['backup', 'balloon', 'block-jobs', 'blockstats', 'capture',
    'chardev', 'cpus', 'cpustats', 'dump', 'history', 'hotpluggable-cpus', 'ioapic', 'iothreads',
    'irq', 'jit', 'kvm', 'memdev', 'memory-devices', 'memory_size_summary', 'mice', 'migrate',
    'migrate_cache_size', 'migrate_capabilities', 'migrate_parameters', 'name', 'network', 'numa',
    'opcount', 'pci', 'pic', 'profile', 'qdm', 'qtree', 'ramblock', 'rdma', 'roms', 'savevm',
    'sev', 'snapshots', 'spice', 'status', 'tpm', 'usb', 'usbhost', 'usernet', 'uuid', 'version',
    'vm-generation-id', 'vnc'] as const;

export const VALID_QEMU_INFO_OPTION = ['block', 'lapic', 'mtree', 'qom-tree', 'registers', 'sync-profile', 'trace-events'] as const;

export const VALID_QEMU_INFO_PARAM = ['rocker-of-dpa-flows', 'rocker-of-dpa-groups', 'rocker-ports'] as const;

export type QemuInfoSimple = typeof VALID_QEMU_INFO_SIMPLE[number];
export type QemuInfoOption = typeof VALID_QEMU_INFO_OPTION[number];
export type QemuInfoParam = typeof VALID_QEMU_INFO_PARAM[number];

export interface USBHostInfo {
    bus: string,
    addr: string,
    port: string,
    speed: string,
    class: string,
    vendorId: string,
    productId: string,
    name: string,
}

export interface USBInfo {
    device: string,
    port: string,
    speed: string,
    product: string,
    id: string,
}

export class QmMonitor {
    public calls: number = 0;
    monitor: (command: string) => Promise<string>;

    constructor(private proxmox: Proxmox.Api, private node: string, private vmid: number) {
        const call = proxmox.nodes.$(node).qemu.$(vmid).monitor.$post;
        this.monitor = (command) => {
            this.calls++
            return call({ command })
        };
    }

    info(type: QemuInfoSimple): Promise<string>;
    info(type: QemuInfoOption, ...args: string[]): Promise<string>;
    info(type: QemuInfoParam, arg1: string, ...args: string[]): Promise<string>;

    async info(type: QemuInfoSimple | QemuInfoOption | QemuInfoParam, ...args: string[]): Promise<string> {
        let ext = args.join(' ');
        if (ext)
            ext = ' ' + ext;
        return this.monitor(`info ${type}${ext}`);
    }

    async infoUsb(filters?: { vendorId?: RegExp, productId?: RegExp, name?: RegExp }): Promise<USBInfo[]> {
        //Device 1.1, Port 1, Speed 1.5 Mb/s, Product USB OPTICAL MOUSE , ID: mouse
        //Device 1.0, Port 2, Speed 12 Mb/s, Product Gaming KB , ID: keyboard
        const text = await this.info('usb');
        const expected = ((text.match(/[\r\n]+/g) || []).length);
        const matches = text.matchAll(/Device ([\d.]+), Port ([\d.]+), Speed ([\d KMGTbfs\/.]+)(?:, Product (.+), ID: (.+))?/g);
        let results = [...matches].map(m => ({
            device: m[1],
            port: m[2],
            speed: m[3],
            product: m[4],
            id: m[5],
        }))
        if (expected != results.length) {
            throw Error(`Identify ${results.length} usb element should find ${expected} Error in API, Failed to parse:\n${text}`);
        }
        return results;
    }

    async deviceDel(id: string): Promise<string> {
        const text = await this.monitor(`device_del ${id}`);
        // return `Error: Device '${id}' not found`
        // console.log(text);
        return text;
    }

    /**
     * list available usb on host
     */
    async infoUsbhost(filters?: { vendorId?: RegExp, productId?: RegExp, name?: RegExp }): Promise<USBHostInfo[]> {
        const text = await this.info('usbhost');
        const matches = text.matchAll(/Bus (\d+), Addr (\d+), Port ([\d.]+), Speed ([\d KMGTbfs\/.]+)[\r\n]\s+Class (\d+): USB device ([0-9a-f]{4}):([0-9a-f]{4}), (.*)/gm);
        let results = [...matches].map(m => ({
            bus: m[1],
            addr: m[2],
            port: m[3],
            speed: m[4],
            class: m[5],
            vendorId: m[6],
            productId: m[7],
            name: m[8],
        }))
        if (filters) {
            results = results.filter(usb => {
                if (filters.name && !filters.name.test(usb.name)) {
                    return false;
                }
                if (filters.vendorId && !filters.vendorId.test(usb.name)) {
                    return false;
                }
                if (filters.productId && !filters.productId.test(usb.name)) {
                    return false;
                }
                return true;
            })
        }
        return results;
    }
    // 
    // https://www.linux-kvm.org/page/USB
    // https://www.qemu.org/docs/master/qemu-doc.html
    async deviceAddById(id: string, params: { vendorId: string, productId: string }): Promise<any> {
        // TODO: check param values
        params.vendorId = params.vendorId.replace(/0x/i, '');
        params.productId = params.productId.replace(/0x/i, '');
        const text = await this.monitor(`device_add usb-host,vendorid=0x${params.vendorId},productid=0x${params.productId},id=${id}`);
        // if (text)
        //    console.log(`deviceAddById return: '${text}'`);
        return text;
    }

    // usb-host,hostbus=2,hostport=4,id=front2
    // device_add driver[,prop=value][,...] -- add device, like -device on the command line
    async deviceAddByPort(id: string, params: { bus: string, port: string }): Promise<any> {
        // TODO: check param values
        const text = await this.monitor(`device_add usb-host,hostbus=${params.bus},hostport=${params.port},id=${id}`);
        // `Duplicate ID '${id}' for device\nTry "help device_add" for more information`
        //if (text)
        //    console.log(`deviceAddByPort return: '${text}'`);
        return text;
    }

    async deviceAddMissing(id: string, filters: { vendorId?: RegExp, productId?: RegExp, name?: RegExp }): Promise<any> {
        let connected = await this.infoUsb();
        if (connected.findIndex(v => v.id === id) >= 0) {
          throw Error(`USB device ${id} already present`);
        }
        {
            let usbs = await this.infoUsbhost(filters);
            for (let i = 0; i < usbs.length; i++) {
                const id2 = i ? `${id}-${i}` : id;
                // console.log(`connecting '${usbs[i].name}' as ${id2}`);
                this.deviceAddByPort(id2, usbs[i]);
            }
        }
    }
}
